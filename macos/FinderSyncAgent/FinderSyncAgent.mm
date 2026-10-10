#import <Cocoa/Cocoa.h>
#import <Security/Security.h>
#include <errno.h>
#include <mach-o/dyld.h>
#include <signal.h>
#include <stdio.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <unistd.h>

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
static NSString *const kMissingAppMessage =
    @"Font Buttler couldn't be found. Open it once from its new location.";

static BOOL GuestMeetsRequirement(audit_token_t token, NSString *requirementString) {
  if (!requirementString.length) return NO;
  SecRequirementRef requirement = NULL;
  OSStatus created = SecRequirementCreateWithString((__bridge CFStringRef)requirementString, kSecCSDefaultFlags, &requirement);
  if (created != errSecSuccess || !requirement) return NO;
  CFDataRef auditData = CFDataCreate(kCFAllocatorDefault, (const UInt8 *)&token, (CFIndex)sizeof(token));
  if (!auditData) {
    CFRelease(requirement);
    return NO;
  }
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
  if (copyStatus != errSecSuccess || !guest) {
    CFRelease(requirement);
    return NO;
  }
  OSStatus signatureStatus = SecCodeCheckValidity(guest, kSecCSStrictValidate, requirement);
  CFRelease(guest);
  CFRelease(requirement);
  return signatureStatus == errSecSuccess;
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
static BOOL PeerMeets(int fd, NSString *requirement);
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
  if (!PeerMeets(fd, kParentRequirement)) {
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
// permission. The running app presents the error with its own permission.
// A missing app gets one record in that app's data directory.
static BOOL ForwardErrorToApp(NSString *message) {
  if (message.length == 0) return NO;
  return SendPayload(@{@"error" : message});
}

static void WritePendingFinderSyncError(NSString *message) {
  if (message.length == 0 || message.length > 500) return;
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
  struct stat fileStat;
  if (lstat(filePath, &fileStat) == 0 && !S_ISREG(fileStat.st_mode)) return;
  NSMutableArray *errors = [NSMutableArray array];
  NSData *existing = [NSData dataWithContentsOfFile:file];
  if (existing) {
    id parsed = [NSJSONSerialization JSONObjectWithData:existing options:0 error:nil];
    NSArray *list = [parsed isKindOfClass:[NSDictionary class]] ? parsed[@"errors"] : nil;
    if ([list isKindOfClass:[NSArray class]]) {
      for (id item in list) {
        if (![item isKindOfClass:[NSDictionary class]]) continue;
        NSString *prior = [item[@"message"] isKindOfClass:[NSString class]] ? item[@"message"] : @"";
        if (prior.length == 0) continue;
        if ([prior isEqualToString:message]) return;
        [errors addObject:item];
      }
    }
  }
  NSTimeInterval millis = floor(NSDate.date.timeIntervalSince1970 * 1000.0);
  [errors addObject:@{@"message" : message, @"at" : @((long long)millis)}];
  NSData *data = [NSJSONSerialization dataWithJSONObject:@{@"errors" : errors} options:0 error:nil];
  if (!data) return;
  [data writeToFile:file atomically:YES];
  chmod(filePath, 0600);
}

static void ReportFinderSyncError(void (^reply)(NSString *), NSString *message) {
  NSLog(@"Finder Sync: %@", message ?: @"");
  if (message.length && !ForwardErrorToApp(message)) WritePendingFinderSyncError(message);
  if (reply) reply(message);
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

static BOOL PeerMeets(int fd, NSString *requirement) {
  audit_token_t token;
  memset(&token, 0, sizeof(token));
  socklen_t length = (socklen_t)sizeof(token);
  if (getsockopt(fd, SOL_LOCAL, LOCAL_PEERTOKEN, &token, &length) != 0) return NO;
  if (length != sizeof(token)) return NO;
  return GuestMeetsRequirement(token, requirement);
}

static void ConfigureSocket(int fd) {
  int yes = 1;
  setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &yes, sizeof(yes));
  struct timeval budget;
  budget.tv_sec = 2;
  budget.tv_usec = 0;
  setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &budget, sizeof(budget));
  setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &budget, sizeof(budget));
}

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
  // apps[0] is this helper. The next .app is the Font Buttler bundle that owns it.
  if (apps.count < 2) return nil;
  return [NSURL fileURLWithPath:apps[1]];
}

// One openApplication for this click. The failure string is written on the
// main queue and read on the forward queue only after the semaphore. The
// next submit resets g_launchedApp and may try once. There is no process-wide
// failure flag shared across queues.
static NSString *LaunchContainingAppOnce(void) {
  if (g_launchedApp) return nil;
  NSURL *appURL = ContainingAppURL();
  BOOL exists = appURL != nil && [[NSFileManager defaultManager] fileExistsAtPath:appURL.path];
  if (!exists) return kMissingAppMessage;
  g_launchedApp = YES;
  __block NSString *failure = nil;
  dispatch_semaphore_t opened = dispatch_semaphore_create(0);
  dispatch_async(dispatch_get_main_queue(), ^{
    NSWorkspaceOpenConfiguration *configuration = [NSWorkspaceOpenConfiguration configuration];
    configuration.activates = YES;
    [[NSWorkspace sharedWorkspace] openApplicationAtURL:appURL
                                          configuration:configuration
                                      completionHandler:^(NSRunningApplication *app, NSError *error) {
                                        if (error || !app) failure = kMissingAppMessage;
                                        dispatch_semaphore_signal(opened);
                                      }];
  });
  if (dispatch_semaphore_wait(opened, dispatch_time(DISPATCH_TIME_NOW, 2 * NSEC_PER_SEC)) != 0) return nil;
  if (failure.length) {
    g_launchedApp = NO;
    return failure;
  }
  return nil;
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
  if ([connection respondsToSelector:@selector(setCodeSigningRequirement:)]) {
    [connection setCodeSigningRequirement:requirement];
  }
  if (!GuestMeetsRequirement(connection.auditToken, requirement)) return NO;
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
    if (!known) {
      ReportFinderSyncError(reply, @"Unknown Finder Sync action.");
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
    NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:8.0];
    BOOL launched = NO;
    while (YES) {
      if (ForwardToApp(wire, accepted, overflow, request)) {
        g_launchedApp = NO;
        if (reply) reply(nil);
        return;
      }
      if (!launched) {
        launched = YES;
        NSString *failure = LaunchContainingAppOnce();
        if (failure.length) {
          ReportFinderSyncError(reply, failure);
          return;
        }
      }
      if ([deadline timeIntervalSinceNow] <= 0) break;
      usleep(50 * 1000);
    }
    ReportFinderSyncError(reply, @"Font Buttler is not running.");
  });
}

@end

int main(int argc, const char *argv[]) {
  (void)argc;
  (void)argv;
  signal(SIGPIPE, SIG_IGN);
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
