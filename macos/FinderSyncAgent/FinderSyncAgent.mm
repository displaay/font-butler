#import <Cocoa/Cocoa.h>
#import <Security/Security.h>
#include <errno.h>
#include <fcntl.h>
#include <libproc.h>
#include <mach-o/dyld.h>
#include <signal.h>
#include <spawn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <unistd.h>

extern char **environ;

#ifndef LOCAL_PEERTOKEN
#define LOCAL_PEERTOKEN 0x006
#endif

// The listener accepts the Finder Sync appex and no other identifier.
static NSString *const kReleaseRequirement =
    @"anchor apple generic and certificate leaf[subject.OU] = \"A7WWML89LQ\" and identifier \"app.fontbutler.desktop.FinderSync\"";
static NSString *const kTestRequirement =
    @"anchor apple generic and certificate leaf[subject.OU] = \"A7WWML89LQ\" and identifier \"app.fontbutler.desktop.FinderSync.Test\"";
static NSString *const kReleaseService = @"A7WWML89LQ.group.app.fontbutler.desktop.FinderSync";
static NSString *const kTestService = @"A7WWML89LQ.group.app.fontbutler.desktop.FinderSync.Test";
static NSString *const kReleaseAgentBundleId = @"app.fontbutler.desktop.FinderSyncAgent";
static NSString *const kTestAgentBundleId = @"app.fontbutler.desktop.FinderSyncAgent.Test";
// The socket peer must be the Font Buttler app. Both flavours share this id.
static NSString *const kParentRequirement =
    @"anchor apple generic and certificate leaf[subject.OU] = \"A7WWML89LQ\" and identifier \"app.fontbutler.desktop\"";
static NSString *const kReleaseSocketName = @"fontbutler-finder-sync.sock";
static NSString *const kTestSocketName = @"fontbutler-finder-sync-test.sock";
static NSString *const kSocketDirectory = @"fontbutler-fs";
static const NSUInteger kFinderSyncMaxFiles = 500;
static const uint32_t kMaxFrame = 2 * 1024 * 1024;

static BOOL g_testFeed = NO;
static BOOL g_launchedApp = NO;
static pid_t g_spawnedPid = 0;
static NSString *const kMissingAppMessage =
    @"Font Buttler couldn't be found. Open it once from its new location.";
static const off_t kPendingErrorMaxBytes = 8192;
static const NSUInteger kPendingErrorMaxEntries = 5;
// Shorter than the XPC client's submit wait. A reply after that wait is
// reported as "connection invalidated" because the client drops the connection.
static const NSTimeInterval kForwardAfterSpawnSeconds = 20;
// The client waits 35s. While the Cuttler spawned for this handoff is still
// alive, keep trying until just before that. A dead process is not starting.
static const NSTimeInterval kForwardWhileStartingSeconds = 32;

static BOOL FinderSyncErrorCodeIsKnown(NSString *code) {
  return [code isEqualToString:@"missing-app"] || [code isEqualToString:@"not-running"] ||
         [code isEqualToString:@"login-items"] || [code isEqualToString:@"unknown-action"];
}

// sockaddr_un.sun_path holds 104 bytes. The team-prefixed group id plus
// "~/Library/Group Containers" does not leave room for a real home directory,
// so the forward socket lives in a private directory under the per-user
// temporary directory. It is not another app's container. Both ends check
// the peer with SecRequirement. The directory name matches finder-sync.mjs.
static BOOL SocketPath(char *out, size_t outSize) {
  if (!out || outSize < 8) return NO;
  char temp[PATH_MAX];
  size_t wrote = confstr(_CS_DARWIN_USER_TEMP_DIR, temp, sizeof(temp));
  if (wrote == 0 || wrote >= sizeof(temp)) return NO;
  NSString *name = g_testFeed ? kTestSocketName : kReleaseSocketName;
  const char *separator = temp[strlen(temp) - 1] == '/' ? "" : "/";
  int formatted = snprintf(out, outSize, "%s%s%s/%s", temp, separator, kSocketDirectory.UTF8String, name.UTF8String);
  if (formatted <= 0 || (size_t)formatted >= outSize) return NO;
  if ((size_t)formatted >= sizeof(((struct sockaddr_un *)0)->sun_path)) return NO;
  return YES;
}

static BOOL WriteAll(int fd, const void *bytes, size_t length);
static BOOL ReadAll(int fd, void *bytes, size_t length);
static BOOL ParentExecutableMatches(int fd);
static void ConfigureSocket(int fd);

static BOOL SendPayload(NSDictionary *payload) {
  char socketPath[sizeof(((struct sockaddr_un *)0)->sun_path)];
  if (!SocketPath(socketPath, sizeof(socketPath))) return NO;
  int fd = socket(AF_UNIX, SOCK_STREAM, 0);
  if (fd < 0) return NO;
  ConfigureSocket(fd);
  struct sockaddr_un address;
  memset(&address, 0, sizeof(address));
  address.sun_family = AF_UNIX;
  if (strlcpy(address.sun_path, socketPath, sizeof(address.sun_path)) >= sizeof(address.sun_path)) {
    close(fd);
    return NO;
  }
  if (connect(fd, (struct sockaddr *)&address, (socklen_t)sizeof(address)) != 0) {
    close(fd);
    return NO;
  }
  if (!ParentExecutableMatches(fd)) {
    close(fd);
    return NO;
  }
  NSData *json = [NSJSONSerialization dataWithJSONObject:payload options:0 error:nil];
  if (!json || json.length == 0 || json.length > kMaxFrame) {
    close(fd);
    return NO;
  }
  uint32_t length = CFSwapInt32HostToBig((uint32_t)json.length);
  BOOL wrote = WriteAll(fd, &length, sizeof(length)) && WriteAll(fd, json.bytes, json.length);
  uint32_t replyLength = 0;
  BOOL readLength = wrote && ReadAll(fd, &replyLength, sizeof(replyLength));
  replyLength = CFSwapInt32BigToHost(replyLength);
  if (!readLength || replyLength == 0 || replyLength > kMaxFrame) {
    close(fd);
    return NO;
  }
  NSMutableData *replyData = [NSMutableData dataWithLength:replyLength];
  if (!ReadAll(fd, replyData.mutableBytes, replyLength)) {
    close(fd);
    return NO;
  }
  close(fd);
  id reply = [NSJSONSerialization JSONObjectWithData:replyData options:0 error:nil];
  return [reply isKindOfClass:[NSDictionary class]] && [reply[@"ok"] boolValue];
}

// The helper is its own app. Posting a notification here would ask for a new
// permission. The running app presents a fixed message for a known code.
// A missing app gets one code in that app's data directory.
static BOOL ForwardErrorToApp(NSString *code) {
  if (!FinderSyncErrorCodeIsKnown(code)) return NO;
  return SendPayload(@{@"error" : code});
}

// O_NOFOLLOW plus fstat. A symlink, a non-regular file, or anything over
// the cap is ignored. Only known codes are kept, and at most five.
static NSArray *ReadPendingFinderSyncErrors(const char *filePath) {
  int fd = open(filePath, O_RDONLY | O_NOFOLLOW);
  if (fd < 0) return @[];
  struct stat st;
  if (fstat(fd, &st) != 0 || !S_ISREG(st.st_mode) || st.st_size < 0 || st.st_size > kPendingErrorMaxBytes) {
    close(fd);
    return @[];
  }
  NSMutableData *data = [NSMutableData dataWithLength:(NSUInteger)st.st_size];
  BOOL ok = st.st_size == 0 || ReadAll(fd, data.mutableBytes, (size_t)st.st_size);
  close(fd);
  if (!ok || data.length == 0) return @[];
  id parsed = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
  NSArray *list = [parsed isKindOfClass:[NSDictionary class]] ? parsed[@"errors"] : nil;
  if (![list isKindOfClass:[NSArray class]]) return @[];
  NSMutableArray *errors = [NSMutableArray array];
  NSMutableSet *seen = [NSMutableSet set];
  for (id item in list) {
    if (errors.count >= kPendingErrorMaxEntries) break;
    if (![item isKindOfClass:[NSDictionary class]]) continue;
    NSString *code = [item[@"code"] isKindOfClass:[NSString class]] ? item[@"code"] : @"";
    if (!FinderSyncErrorCodeIsKnown(code) || [seen containsObject:code]) continue;
    [seen addObject:code];
    id at = item[@"at"];
    [errors addObject:@{@"code" : code, @"at" : [at isKindOfClass:[NSNumber class]] ? at : @0}];
  }
  return errors;
}

// The temp file is created 0600, then renamed over the record. There is no
// chmod after that rename.
static BOOL WritePendingBytes(const char *filePath, NSData *data) {
  if (!data || data.length == 0 || data.length > (NSUInteger)kPendingErrorMaxBytes) return NO;
  char tempPath[PATH_MAX];
  int formatted = snprintf(tempPath, sizeof(tempPath), "%s.tmp", filePath);
  if (formatted <= 0 || (size_t)formatted >= sizeof(tempPath)) return NO;
  unlink(tempPath);
  int fd = open(tempPath, O_CREAT | O_EXCL | O_NOFOLLOW | O_WRONLY, 0600);
  if (fd < 0) return NO;
  if (fchmod(fd, 0600) != 0) {
    close(fd);
    unlink(tempPath);
    return NO;
  }
  BOOL ok = WriteAll(fd, data.bytes, data.length);
  if (ok && fsync(fd) != 0) ok = NO;
  close(fd);
  if (!ok || rename(tempPath, filePath) != 0) {
    unlink(tempPath);
    return NO;
  }
  return YES;
}

static void WritePendingFinderSyncError(NSString *code) {
  if (!FinderSyncErrorCodeIsKnown(code)) return;
  NSString *folder = g_testFeed ? @"Font Buttler Test" : @"Font Buttler";
  NSString *dir = [[NSHomeDirectory() stringByAppendingPathComponent:@"Library/Application Support"]
      stringByAppendingPathComponent:folder];
  const char *dirPath = dir.fileSystemRepresentation;
  struct stat st;
  if (lstat(dirPath, &st) != 0) {
    if (mkdir(dirPath, 0700) != 0) return;
    chmod(dirPath, 0700);
  } else if (S_ISLNK(st.st_mode) || !S_ISDIR(st.st_mode)) {
    return;
  }
  NSString *file = [dir stringByAppendingPathComponent:@"finder-sync-pending-error.json"];
  const char *filePath = file.fileSystemRepresentation;
  if (lstat(filePath, &st) == 0 && !S_ISREG(st.st_mode)) return;
  NSMutableArray *errors = [ReadPendingFinderSyncErrors(filePath) mutableCopy];
  for (id item in errors) {
    if ([item[@"code"] isEqualToString:code]) return;
  }
  if (errors.count >= kPendingErrorMaxEntries) [errors removeObjectAtIndex:0];
  NSTimeInterval millis = floor(NSDate.date.timeIntervalSince1970 * 1000.0);
  [errors addObject:@{@"code" : code, @"at" : @((long long)millis)}];
  NSData *data = [NSJSONSerialization dataWithJSONObject:@{@"errors" : errors} options:0 error:nil];
  if (!data) return;
  WritePendingBytes(filePath, data);
}

static void ReportFinderSyncError(void (^reply)(NSString *), NSString *code, NSString *message) {
  NSLog(@"Finder Sync: %@", message ?: @"");
  if (FinderSyncErrorCodeIsKnown(code) && !ForwardErrorToApp(code)) WritePendingFinderSyncError(code);
  if (reply) reply(message ?: @"");
}

static BOOL WriteAll(int fd, const void *bytes, size_t length) {
  const uint8_t *cursor = (const uint8_t *)bytes;
  size_t sent = 0;
  while (sent < length) {
    ssize_t count = write(fd, cursor + sent, length - sent);
    if (count < 0 && errno == EINTR) continue;
    if (count <= 0) return NO;
    sent += (size_t)count;
  }
  return YES;
}

static BOOL ReadAll(int fd, void *bytes, size_t length) {
  uint8_t *cursor = (uint8_t *)bytes;
  size_t got = 0;
  while (got < length) {
    ssize_t count = read(fd, cursor + got, length - got);
    if (count < 0 && errno == EINTR) continue;
    if (count <= 0) return NO;
    got += (size_t)count;
  }
  return YES;
}

static BOOL ParentExecutableMatches(int fd);

static void ConfigureSocket(int fd) {
  int yes = 1;
  setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &yes, sizeof(yes));
  struct timeval budget;
  budget.tv_sec = 10;
  budget.tv_usec = 0;
  setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &budget, sizeof(budget));
  setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &budget, sizeof(budget));
}

// DMG and loose builds are Cuttler.app. The 0.4.0 update zip is still named
// Font Buttler.app. Test builds are Font Buttler Test.app. The nested helper
// is not one of these.
static NSArray<NSString *> *ProductAppNames(void) {
  return @[ @"Cuttler.app", @"Font Buttler.app", @"Font Buttler Test.app" ];
}

static NSArray<NSString *> *ProductExecutableNames(void) {
  return @[ @"Cuttler", @"Font Buttler", @"Font Buttler Test" ];
}

static NSString *AppexInsideApp(NSString *appPath) {
  return [appPath stringByAppendingPathComponent:@"Contents/PlugIns/Font Buttler Finder Sync.appex"];
}

// The product .app that contains this helper and the Finder Sync appex.
// Launch Services is not asked: a stale Font Buttler registration must not
// hide Cuttler.app, and the zip's Font Buttler.app must still be found.
static NSURL *ContainingAppURL(void) {
  char buffer[4096];
  uint32_t size = sizeof(buffer);
  if (_NSGetExecutablePath(buffer, &size) != 0) return nil;
  char resolved[PATH_MAX];
  if (!realpath(buffer, resolved)) return nil;
  NSString *current = [NSString stringWithUTF8String:resolved];
  NSMutableArray<NSString *> *apps = [NSMutableArray array];
  for (int hop = 0; hop < 12; hop += 1) {
    if ([current.pathExtension isEqualToString:@"app"]) [apps addObject:current];
    NSString *parent = current.stringByDeletingLastPathComponent;
    if (parent.length == 0 || [parent isEqualToString:current]) break;
    current = parent;
  }
  NSFileManager *files = [NSFileManager defaultManager];
  NSString *named = nil;
  for (NSString *app in apps) {
    if ([[app lastPathComponent] isEqualToString:@"FontButtlerFinderSyncAgent.app"]) continue;
    if (![ProductAppNames() containsObject:app.lastPathComponent]) continue;
    if ([files fileExistsAtPath:AppexInsideApp(app)]) return [NSURL fileURLWithPath:app isDirectory:YES];
    if (!named) named = app;
  }
  for (NSString *app in apps) {
    if ([[app lastPathComponent] isEqualToString:@"FontButtlerFinderSyncAgent.app"]) continue;
    if ([files fileExistsAtPath:AppexInsideApp(app)]) return [NSURL fileURLWithPath:app isDirectory:YES];
  }
  if (!named) return nil;
  return [NSURL fileURLWithPath:named isDirectory:YES];
}

// CFBundleExecutable first, then Cuttler / Font Buttler / Font Buttler Test.
// The zip renames only the bundle folder, so Font Buttler.app still contains
// Contents/MacOS/Cuttler.
static NSString *BundleExecutable(NSURL *appURL) {
  if (!appURL.path.length) return nil;
  NSString *plistPath = [appURL.path stringByAppendingPathComponent:@"Contents/Info.plist"];
  NSDictionary *plist = [NSDictionary dictionaryWithContentsOfFile:plistPath];
  NSString *named = [plist[@"CFBundleExecutable"] isKindOfClass:[NSString class]] ? plist[@"CFBundleExecutable"] : @"";
  NSMutableArray<NSString *> *candidates = [NSMutableArray array];
  if (named.length) [candidates addObject:named];
  for (NSString *name in ProductExecutableNames()) {
    if (![candidates containsObject:name]) [candidates addObject:name];
  }
  NSString *folder = appURL.lastPathComponent.stringByDeletingPathExtension;
  if (folder.length && ![candidates containsObject:folder]) [candidates addObject:folder];
  NSFileManager *files = [NSFileManager defaultManager];
  for (NSString *name in candidates) {
    NSString *binary = [[appURL.path stringByAppendingPathComponent:@"Contents/MacOS"] stringByAppendingPathComponent:name];
    if ([files fileExistsAtPath:binary]) return binary;
  }
  return nil;
}

// Spawn the binary inside the bundle we found. NSWorkspace open would follow
// the bundle id back to a missing Font Buttler.app.
static BOOL SpawnExecutable(NSString *binary) {
  if (!binary.length) return NO;
  const char *path = binary.fileSystemRepresentation;
  if (!path || !path[0]) return NO;
  char *owned = strdup(path);
  if (!owned) return NO;
  posix_spawnattr_t attr;
  if (posix_spawnattr_init(&attr) != 0) {
    free(owned);
    return NO;
  }
  // The helper ignores SIGCHLD so its own spawn does not zombie. The child
  // must not inherit that: Electron reaps its helpers with SIGCHLD, and a
  // spawned Cuttler otherwise never finishes starting or opens the socket.
  sigset_t defaults;
  sigemptyset(&defaults);
  sigaddset(&defaults, SIGCHLD);
  sigaddset(&defaults, SIGPIPE);
  int flagsSet = posix_spawnattr_setflags(&attr, POSIX_SPAWN_SETPGROUP | POSIX_SPAWN_SETSIGDEF);
  int signalsSet = posix_spawnattr_setsigdefault(&attr, &defaults);
  int groupSet = posix_spawnattr_setpgroup(&attr, 0);
  if (flagsSet != 0 || signalsSet != 0 || groupSet != 0) {
    posix_spawnattr_destroy(&attr);
    free(owned);
    return NO;
  }
  char *argv[] = {owned, NULL};
  pid_t pid = 0;
  int result = posix_spawn(&pid, owned, NULL, &attr, argv, environ);
  posix_spawnattr_destroy(&attr);
  free(owned);
  if (result == 0 && pid > 0) g_spawnedPid = pid;
  return result == 0 && pid > 0;
}

// The helper ignores SIGCHLD, so a child that has exited is not a zombie.
// kill with signal 0 only asks whether that spawned pid is still there.
static BOOL SpawnedProcessIsAlive(void) {
  if (g_spawnedPid <= 0) return NO;
  if (kill(g_spawnedPid, 0) == 0) return YES;
  return errno == EPERM;
}

// One spawn for this click. The next submit resets g_launchedApp and may try
// once. There is no process-wide failure flag shared across queues.
static NSString *LaunchContainingAppOnce(void) {
  if (g_launchedApp) return nil;
  NSURL *appURL = ContainingAppURL();
  NSString *binary = BundleExecutable(appURL);
  if (!binary.length) return kMissingAppMessage;
  g_launchedApp = YES;
  if (!SpawnExecutable(binary)) {
    g_launchedApp = NO;
    return kMissingAppMessage;
  }
  return nil;
}

static BOOL PeerSigningFacts(int fd, NSString **pathOut, NSString **identifierOut) {
  if (pathOut) *pathOut = nil;
  if (identifierOut) *identifierOut = nil;
  NSString *path = nil;
  NSString *identifier = nil;
  BOOL ok = NO;
  audit_token_t token;
  memset(&token, 0, sizeof(token));
  socklen_t length = (socklen_t)sizeof(token);
  if (getsockopt(fd, SOL_LOCAL, LOCAL_PEERTOKEN, &token, &length) != 0 || length != sizeof(token)) return NO;
  CFDataRef auditData = CFDataCreate(kCFAllocatorDefault, (const UInt8 *)&token, (CFIndex)sizeof(token));
  if (!auditData) return NO;
  const void *keys[] = {kSecGuestAttributeAudit};
  const void *values[] = {auditData};
  CFDictionaryRef attributes = CFDictionaryCreate(kCFAllocatorDefault, keys, values, 1, &kCFTypeDictionaryKeyCallBacks,
                                                 &kCFTypeDictionaryValueCallBacks);
  SecCodeRef guest = NULL;
  OSStatus copyStatus = errSecInternalError;
  if (attributes) {
    copyStatus = SecCodeCopyGuestWithAttributes(NULL, attributes, kSecCSDefaultFlags, &guest);
    CFRelease(attributes);
  }
  CFRelease(auditData);
  if (copyStatus != errSecSuccess || !guest) return NO;
  CFDictionaryRef information = NULL;
  OSStatus infoStatus = SecCodeCopySigningInformation(guest, kSecCSSigningInformation | kSecCSDynamicInformation, &information);
  CFRelease(guest);
  if (infoStatus != errSecSuccess || !information) return NO;
  CFURLRef executable = (CFURLRef)CFDictionaryGetValue(information, kSecCodeInfoMainExecutable);
  if (executable) {
    NSString *raw = [(__bridge NSURL *)executable path];
    char resolved[PATH_MAX];
    if (raw.length && realpath(raw.fileSystemRepresentation, resolved)) path = [NSString stringWithUTF8String:resolved];
    else if (raw.length) path = raw;
  }
  CFStringRef identifierRef = (CFStringRef)CFDictionaryGetValue(information, kSecCodeInfoIdentifier);
  if (identifierRef && CFGetTypeID(identifierRef) == CFStringGetTypeID()) {
    identifier = [NSString stringWithString:(__bridge NSString *)identifierRef];
  }
  CFRelease(information);
  if (pathOut) *pathOut = path;
  if (identifierOut) *identifierOut = identifier;
  ok = path.length > 0 || identifier.length > 0;
  return ok;
}

static NSString *BundleIdentifierOfApp(NSString *appPath) {
  if (!appPath.length) return @"";
  NSString *plistPath = [appPath stringByAppendingPathComponent:@"Contents/Info.plist"];
  NSDictionary *plist = [NSDictionary dictionaryWithContentsOfFile:plistPath];
  id ident = plist[@"CFBundleIdentifier"];
  return [ident isKindOfClass:[NSString class]] ? ident : @"";
}

static NSString *ExpectedParentBundleIdentifier(void) {
  if (g_testFeed) return @"app.fontbutler.desktop.test";
  return [kParentRequirement containsString:@"identifier \"app.fontbutler.desktop\""] ? @"app.fontbutler.desktop" : @"";
}

static BOOL PathIsInsideApp(NSString *path, NSString *appPath) {
  if (!path.length || !appPath.length) return NO;
  if ([path isEqualToString:appPath]) return YES;
  NSString *root = [appPath hasSuffix:@"/"] ? appPath : [appPath stringByAppendingString:@"/"];
  return [path hasPrefix:root];
}

// The socket peer's audit token carries the process in val[5]. A running
// Electron image does not yield app.fontbutler.desktop from
// kSecCodeInfoIdentifier, and kSecCodeInfoMainExecutable is often missing, so
// the Info.plist check never saw the spawned Cuttler. The kernel path is the
// binary the Mac check starts: Contents/MacOS/Cuttler inside Cuttler.app.
static NSString *PeerKernelPath(int fd) {
  audit_token_t token;
  memset(&token, 0, sizeof(token));
  socklen_t length = (socklen_t)sizeof(token);
  if (getsockopt(fd, SOL_LOCAL, LOCAL_PEERTOKEN, &token, &length) != 0 || length != sizeof(token)) return nil;
  char buffer[PROC_PIDPATHINFO_MAXSIZE];
  int wrote = proc_pidpath((pid_t)token.val[5], buffer, sizeof(buffer));
  if (wrote <= 0) return nil;
  char resolved[PATH_MAX];
  if (realpath(buffer, resolved)) return [NSString stringWithUTF8String:resolved];
  return [NSString stringWithUTF8String:buffer];
}

static BOOL AncestorHasBundleIdentifier(NSString *path, NSString *expected) {
  if (!path.length || !expected.length) return NO;
  NSString *current = path;
  for (int hop = 0; hop < 12; hop += 1) {
    if ([current.pathExtension isEqualToString:@"app"] &&
        [BundleIdentifierOfApp(current) isEqualToString:expected]) {
      return YES;
    }
    NSString *parent = current.stringByDeletingLastPathComponent;
    if (parent.length == 0 || [parent isEqualToString:current]) break;
    current = parent;
  }
  return NO;
}

// Path and Info.plist are not enough: a user-writable .app can contain an
// unsigned binary whose ancestor plist still says app.fontbutler.desktop.
// The audit token must satisfy the team and identifier requirement.
static BOOL PeerMeetsParentRequirement(int fd) {
  NSString *expected = ExpectedParentBundleIdentifier();
  if (!expected.length) return NO;
  NSString *requirementText =
      [NSString stringWithFormat:@"anchor apple generic and certificate leaf[subject.OU] = \"A7WWML89LQ\" and identifier \"%@\"",
                                 expected];
  audit_token_t token;
  memset(&token, 0, sizeof(token));
  socklen_t length = (socklen_t)sizeof(token);
  if (getsockopt(fd, SOL_LOCAL, LOCAL_PEERTOKEN, &token, &length) != 0 || length != sizeof(token)) return NO;
  CFDataRef auditData = CFDataCreate(kCFAllocatorDefault, (const UInt8 *)&token, (CFIndex)sizeof(token));
  if (!auditData) return NO;
  const void *keys[] = {kSecGuestAttributeAudit};
  const void *values[] = {auditData};
  CFDictionaryRef attributes = CFDictionaryCreate(kCFAllocatorDefault, keys, values, 1, &kCFTypeDictionaryKeyCallBacks,
                                                 &kCFTypeDictionaryValueCallBacks);
  SecCodeRef guest = NULL;
  OSStatus copyStatus = errSecInternalError;
  if (attributes) {
    copyStatus = SecCodeCopyGuestWithAttributes(NULL, attributes, kSecCSDefaultFlags, &guest);
    CFRelease(attributes);
  }
  CFRelease(auditData);
  if (copyStatus != errSecSuccess || !guest) return NO;
  SecRequirementRef requirement = NULL;
  OSStatus created = SecRequirementCreateWithString((__bridge CFStringRef)requirementText, kSecCSDefaultFlags, &requirement);
  if (created != errSecSuccess || !requirement) {
    CFRelease(guest);
    return NO;
  }
  OSStatus valid = SecCodeCheckValidity(guest, kSecCSStrictValidate, requirement);
  CFRelease(requirement);
  CFRelease(guest);
  return valid == errSecSuccess;
}

// The socket peer has to be this helper's containing app. The XPC peer is the
// Finder Sync appex or the Mac check client, not Electron. An installed
// Font Buttler.app with the same bundle id is a different path and does not
// satisfy a handoff whose helper lives in release Cuttler.app.
static BOOL ParentExecutableMatches(int fd) {
  NSString *expected = ExpectedParentBundleIdentifier();
  if (!expected.length) return NO;
  if (!PeerMeetsParentRequirement(fd)) return NO;
  NSURL *appURL = ContainingAppURL();
  if (![BundleIdentifierOfApp(appURL.path) isEqualToString:expected]) return NO;
  NSString *kernel = PeerKernelPath(fd);
  if (PathIsInsideApp(kernel, appURL.path) && AncestorHasBundleIdentifier(kernel, expected)) return YES;
  NSString *path = nil;
  NSString *identifier = nil;
  if (!PeerSigningFacts(fd, &path, &identifier)) return NO;
  if (!PathIsInsideApp(path, appURL.path)) return NO;
  if ([identifier isEqualToString:expected]) return YES;
  if (AncestorHasBundleIdentifier(path, expected)) return YES;
  return NO;
}

static NSString *RunningProductName(void) {
  NSURL *appURL = ContainingAppURL();
  NSString *base = appURL.lastPathComponent ?: @"";
  if ([base hasSuffix:@".app"]) {
    NSString *name = [base substringToIndex:base.length - [@".app" length]];
    if ([ProductExecutableNames() containsObject:name]) return name;
  }
  return @"Cuttler";
}

static NSString *NotRunningMessage(void) {
  return [NSString stringWithFormat:@"%@ is not running.", RunningProductName()];
}

static BOOL ForwardToApp(NSString *action, NSArray<NSString *> *paths, BOOL overflow, NSString *requestId) {
  return SendPayload(@{
    @"action" : action ?: @"",
    @"paths" : overflow ? @[] : (paths ?: @[]),
    @"overflow" : @(overflow),
    @"requestId" : requestId ?: @"",
  });
}

@protocol FontButtlerFinderSyncHandoff
- (void)pingWithReply:(void (^)(NSString *error))reply;
- (void)statusWithReply:(void (^)(NSString *error))reply;
- (void)submitAction:(NSString *)action
               paths:(NSArray<NSString *> *)paths
           requestId:(NSString *)requestId
               reply:(void (^)(NSString *error))reply;
@end

@interface FontButtlerFinderSyncAgent : NSObject <NSXPCListenerDelegate, FontButtlerFinderSyncHandoff>
@property(nonatomic, strong) NSXPCListener *listener;
@property(nonatomic, copy) NSString *requirement;
@property(nonatomic, strong) dispatch_queue_t forwardQueue;
@end

@implementation FontButtlerFinderSyncAgent

- (BOOL)start {
  NSString *bundleId = [NSBundle mainBundle].bundleIdentifier;
  if ([bundleId isEqualToString:kTestAgentBundleId]) g_testFeed = YES;
  else if ([bundleId isEqualToString:kReleaseAgentBundleId]) g_testFeed = NO;
  else return NO;
  self.requirement = g_testFeed ? kTestRequirement : kReleaseRequirement;
  self.forwardQueue = dispatch_queue_create("app.fontbutler.desktop.FinderSyncAgent.forward", DISPATCH_QUEUE_SERIAL);
  NSXPCListener *listener = [[NSXPCListener alloc] initWithMachServiceName:(g_testFeed ? kTestService : kReleaseService)];
  listener.delegate = self;
  self.listener = listener;
  [listener resume];
  return YES;
}

- (BOOL)listener:(NSXPCListener *)listener shouldAcceptNewConnection:(NSXPCConnection *)connection {
  (void)listener;
  NSString *requirement = self.requirement.length ? self.requirement : (g_testFeed ? kTestRequirement : kReleaseRequirement);
  // NSXPCConnection has no public auditToken. setCodeSigningRequirement is the
  // supported check: the XPC runtime evaluates it against the peer. A process
  // id is not a substitute. Before macOS 13 the connection is refused.
  SecRequirementRef parsed = NULL;
  OSStatus created = SecRequirementCreateWithString((__bridge CFStringRef)requirement, kSecCSDefaultFlags, &parsed);
  if (parsed) CFRelease(parsed);
  if (created != errSecSuccess) return NO;
  if (@available(macOS 13.0, *)) {
    [connection setCodeSigningRequirement:requirement];
  } else {
    return NO;
  }
  connection.exportedInterface = [NSXPCInterface interfaceWithProtocol:@protocol(FontButtlerFinderSyncHandoff)];
  connection.exportedObject = self;
  [connection resume];
  return YES;
}

- (void)pingWithReply:(void (^)(NSString *))reply {
  if (reply) reply(nil);
}

- (void)statusWithReply:(void (^)(NSString *))reply {
  if (reply) reply(nil);
}

- (void)submitAction:(NSString *)action
               paths:(NSArray<NSString *> *)paths
           requestId:(NSString *)requestId
               reply:(void (^)(NSString *))reply {
  NSString *wire = [action isKindOfClass:[NSString class]] ? action : @"";
  BOOL known = [wire isEqualToString:@"install"] || [wire isEqualToString:@"installAs"];
  NSArray *incoming = [paths isKindOfClass:[NSArray class]] ? paths : @[];
  NSString *request = [requestId isKindOfClass:[NSString class]] ? requestId : @"";
  dispatch_async(self.forwardQueue, ^{
    g_launchedApp = NO;
    g_spawnedPid = 0;
    if (!known) {
      ReportFinderSyncError(reply, @"unknown-action", @"Unknown Finder Sync action.");
      return;
    }
    BOOL overflow = incoming.count > kFinderSyncMaxFiles;
    NSMutableArray<NSString *> *accepted = [NSMutableArray array];
    if (!overflow) {
      for (id item in incoming) {
        if (![item isKindOfClass:[NSString class]] || [item length] == 0 || [item length] > 4096) continue;
        [accepted addObject:item];
      }
    }
    NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:kForwardAfterSpawnSeconds];
    NSDate *startingDeadline = [NSDate dateWithTimeIntervalSinceNow:kForwardWhileStartingSeconds];
    BOOL launched = NO;
    while (YES) {
      if (ForwardToApp(wire, accepted, overflow, request)) {
        g_launchedApp = NO;
        g_spawnedPid = 0;
        if (reply) reply(nil);
        return;
      }
      if (!launched) {
        launched = YES;
        NSString *failure = LaunchContainingAppOnce();
        if (failure.length) {
          ReportFinderSyncError(reply, @"missing-app", failure);
          return;
        }
      }
      // A live child is still starting. A dead one, or no child, stops at
      // the shorter deadline so the XPC client still receives a reply.
      if ([deadline timeIntervalSinceNow] <= 0 && !SpawnedProcessIsAlive()) break;
      if ([startingDeadline timeIntervalSinceNow] <= 0) break;
      usleep(50 * 1000);
    }
    ReportFinderSyncError(reply, @"not-running", NotRunningMessage());
  });
}

@end

int main(int argc, const char *argv[]) {
  (void)argc;
  (void)argv;
  signal(SIGPIPE, SIG_IGN);
  signal(SIGCHLD, SIG_IGN);
  @autoreleasepool {
    FontButtlerFinderSyncAgent *agent = [FontButtlerFinderSyncAgent new];
    if (![agent start]) {
      fprintf(stderr, "Finder Sync agent bundle id is not a Font Buttler agent\n");
      return 1;
    }
    [[NSRunLoop currentRunLoop] run];
  }
  return 0;
}
