#import <Cocoa/Cocoa.h>
#import <Security/Security.h>
#import <ServiceManagement/ServiceManagement.h>
#include <mach-o/dyld.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct napi_env__ *napi_env;
typedef struct napi_value__ *napi_value;
typedef struct napi_callback_info__ *napi_callback_info;
typedef struct napi_threadsafe_function__ *napi_threadsafe_function;

typedef enum { napi_ok = 0 } napi_status;
typedef enum {
  napi_undefined,
  napi_null,
  napi_boolean,
  napi_number,
  napi_string,
  napi_symbol,
  napi_object,
  napi_function,
  napi_external,
  napi_bigint
} napi_valuetype;

typedef napi_value (*napi_callback)(napi_env env, napi_callback_info info);
typedef void (*napi_finalize)(napi_env env, void *finalize_data, void *finalize_hint);
typedef void (*napi_threadsafe_function_call_js)(napi_env env, napi_value js_callback, void *context, void *data);

typedef enum { napi_tsfn_release, napi_tsfn_abort } napi_threadsafe_function_release_mode;
typedef enum { napi_tsfn_nonblocking, napi_tsfn_blocking } napi_threadsafe_function_call_mode;

extern "C" {
napi_status napi_create_function(napi_env env, const char *utf8name, size_t length, napi_callback cb, void *data,
                                 napi_value *result);
napi_status napi_create_object(napi_env env, napi_value *result);
napi_status napi_set_named_property(napi_env env, napi_value object, const char *utf8name, napi_value value);
napi_status napi_get_cb_info(napi_env env, napi_callback_info cbinfo, size_t *argc, napi_value *argv, napi_value *this_arg,
                             void **data);
napi_status napi_typeof(napi_env env, napi_value value, napi_valuetype *result);
napi_status napi_get_undefined(napi_env env, napi_value *result);
napi_status napi_create_string_utf8(napi_env env, const char *str, size_t length, napi_value *result);
napi_status napi_create_array_with_length(napi_env env, size_t length, napi_value *result);
napi_status napi_set_element(napi_env env, napi_value object, uint32_t index, napi_value value);
napi_status napi_create_threadsafe_function(napi_env env, napi_value func, napi_value async_resource,
                                            napi_value async_resource_name, size_t max_queue_size,
                                            size_t initial_thread_count, void *thread_finalize_data,
                                            napi_finalize thread_finalize_cb, void *context,
                                            napi_threadsafe_function_call_js call_js_cb,
                                            napi_threadsafe_function *result);
napi_status napi_call_threadsafe_function(napi_threadsafe_function func, void *data,
                                          napi_threadsafe_function_call_mode is_blocking);
napi_status napi_release_threadsafe_function(napi_threadsafe_function func, napi_threadsafe_function_release_mode mode);
napi_status napi_unref_threadsafe_function(napi_env env, napi_threadsafe_function func);
napi_status napi_call_function(napi_env env, napi_value recv, napi_value func, size_t argc, const napi_value *argv,
                               napi_value *result);
}

typedef struct {
  int nm_version;
  unsigned int nm_flags;
  const char *nm_filename;
  napi_value (*nm_register_func)(napi_env, napi_value);
  const char *nm_modname;
  void *nm_priv;
  void *reserved[4];
} napi_module;

extern "C" void napi_module_register(napi_module *mod);

#define NAPI_AUTO_LENGTH SIZE_MAX
#define NAPI_C_CTOR(fn)                                \
  static void fn(void) __attribute__((constructor)); \
  static void fn(void)

#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <unistd.h>

#ifndef LOCAL_PEERTOKEN
#define LOCAL_PEERTOKEN 0x006
#endif

// The socket peer must be this build's launchd helper, not the appex.
// The helper is the process whose listener accepts the appex.
static NSString *const kReleaseAgentRequirement =
    @"anchor apple generic and certificate leaf[subject.OU] = \"A7WWML89LQ\" and identifier \"app.fontbutler.desktop.FinderSyncAgent\"";
static NSString *const kTestAgentRequirement =
    @"anchor apple generic and certificate leaf[subject.OU] = \"A7WWML89LQ\" and identifier \"app.fontbutler.desktop.FinderSyncAgent.Test\"";
static NSString *const kReleaseAgentLabel = @"app.fontbutler.desktop.FinderSyncAgent";
static NSString *const kTestAgentLabel = @"app.fontbutler.desktop.FinderSyncAgent.Test";
static NSString *const kReleaseService = @"A7WWML89LQ.group.app.fontbutler.desktop.FinderSync";
static NSString *const kTestService = @"A7WWML89LQ.group.app.fontbutler.desktop.FinderSync.Test";
static NSString *const kReleaseSocketName = @"fontbutler-finder-sync.sock";
static NSString *const kTestSocketName = @"fontbutler-finder-sync-test.sock";
static const NSUInteger kFinderSyncMaxFiles = 500;
static const uint32_t kMaxFrame = 2 * 1024 * 1024;

static napi_threadsafe_function g_tsfn = nullptr;
static NSMutableArray<NSDictionary *> *g_queued = nil;

static NSLock *HandoffLock(void) {
  static NSLock *lock;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    lock = [NSLock new];
  });
  return lock;
}

typedef struct {
  char *action;
  char *requestId;
  char **paths;
  size_t count;
  bool overflow;
} HandoffCall;

static char *DupCString(const char *value) {
  return strdup(value ? value : "");
}

static HandoffCall *HandoffCallCreate(NSString *action, NSArray<NSString *> *paths, bool overflow, NSString *requestId) {
  HandoffCall *call = (HandoffCall *)calloc(1, sizeof(HandoffCall));
  if (!call) return nullptr;
  call->action = DupCString(action.UTF8String);
  call->requestId = DupCString(requestId.UTF8String);
  call->overflow = overflow;
  call->count = overflow ? 0 : paths.count;
  if (call->count > kFinderSyncMaxFiles) call->count = kFinderSyncMaxFiles;
  call->paths = call->count ? (char **)calloc(call->count, sizeof(char *)) : nullptr;
  for (size_t i = 0; i < call->count; i += 1) {
    NSString *path = paths[i];
    call->paths[i] = DupCString([path isKindOfClass:[NSString class]] ? path.UTF8String : "");
  }
  return call;
}

static void HandoffCallDestroy(HandoffCall *call) {
  if (!call) return;
  free(call->action);
  free(call->requestId);
  for (size_t i = 0; i < call->count; i += 1) free(call->paths[i]);
  free(call->paths);
  free(call);
}

static BOOL JsonFlagIsTrue(id value) {
  return value == (id)kCFBooleanTrue;
}

static BOOL ReadJsonNumber(id value, uint64_t *out) {
  if ([value isKindOfClass:[NSNumber class]]) {
    if ([value doubleValue] < 0) return NO;
    *out = [value unsignedLongLongValue];
    return YES;
  }
  if ([value isKindOfClass:[NSString class]]) {
    if ([value hasPrefix:@"-"]) return NO;
    *out = strtoull(value.UTF8String, nullptr, 10);
    return YES;
  }
  return NO;
}

static NSData *ReadFileRange(NSString *path, uint64_t offset, uint64_t length) {
  if (length > 32 * 1024 * 1024) return nil;
  NSFileHandle *handle = [NSFileHandle fileHandleForReadingAtPath:path];
  if (!handle) return nil;
  NSData *data = nil;
  @try {
    [handle seekToFileOffset:offset];
    data = [handle readDataOfLength:(NSUInteger)length];
  } @catch (NSException *exception) {
    data = nil;
  }
  [handle closeFile];
  return data;
}

static NSData *ReadAsarPackageJson(NSString *asarPath) {
  NSData *prefix = ReadFileRange(asarPath, 0, 16);
  if (prefix.length < 8) return nil;
  const uint8_t *bytes = (const uint8_t *)prefix.bytes;
  uint32_t pickleSize = 0;
  uint32_t headerSize = 0;
  memcpy(&pickleSize, bytes, 4);
  memcpy(&headerSize, bytes + 4, 4);
  if (pickleSize != 4 || headerSize < 8) return nil;
  NSData *headerBuf = ReadFileRange(asarPath, 8, headerSize);
  if (headerBuf.length < headerSize) return nil;
  const uint8_t *headerBytes = (const uint8_t *)headerBuf.bytes;
  int32_t stringLength = 0;
  memcpy(&stringLength, headerBytes + 4, 4);
  if (stringLength < 2 || 8 + (uint32_t)stringLength > headerBuf.length) return nil;
  NSData *jsonData = [headerBuf subdataWithRange:NSMakeRange(8, (NSUInteger)stringLength)];
  id header = [NSJSONSerialization JSONObjectWithData:jsonData options:0 error:nil];
  if (![header isKindOfClass:[NSDictionary class]]) return nil;
  id files = header[@"files"];
  if (![files isKindOfClass:[NSDictionary class]]) return nil;
  id entry = files[@"package.json"];
  if (![entry isKindOfClass:[NSDictionary class]] || entry[@"unpacked"]) return nil;
  uint64_t offset = 0;
  uint64_t size = 0;
  if (!ReadJsonNumber(entry[@"offset"], &offset) || !ReadJsonNumber(entry[@"size"], &size)) return nil;
  return ReadFileRange(asarPath, 8 + (uint64_t)headerSize + offset, size);
}

static NSString *OutermostAppBundle(void) {
  char buffer[4096];
  uint32_t size = sizeof(buffer);
  if (_NSGetExecutablePath(buffer, &size) != 0) return nil;
  char resolved[PATH_MAX];
  if (!realpath(buffer, resolved)) return nil;
  NSString *current = [NSString stringWithUTF8String:resolved];
  for (int hop = 0; hop < 12; hop += 1) {
    if ([current.pathExtension isEqualToString:@"app"]) return current;
    NSString *parent = current.stringByDeletingLastPathComponent;
    if (parent.length == 0 || [parent isEqualToString:current]) return nil;
    current = parent;
  }
  return nil;
}

// Unreadable marker fails closed onto the release requirement, so a test appex
// cannot connect when this build cannot prove it is the test feed.
static BOOL CurrentBuildIsTestFeed(void) {
  NSString *app = OutermostAppBundle();
  if (!app.length) return NO;
  NSString *loosePath = [app stringByAppendingPathComponent:@"Contents/Resources/app/package.json"];
  NSData *loose = [NSData dataWithContentsOfFile:loosePath];
  if (loose.length) {
    id json = [NSJSONSerialization JSONObjectWithData:loose options:0 error:nil];
    if ([json isKindOfClass:[NSDictionary class]] && JsonFlagIsTrue(json[@"fontButlerTestFeed"])) return YES;
  }
  NSString *asarPath = [app stringByAppendingPathComponent:@"Contents/Resources/app.asar"];
  NSData *packed = ReadAsarPackageJson(asarPath);
  if (!packed.length) return NO;
  id json = [NSJSONSerialization JSONObjectWithData:packed options:0 error:nil];
  if (![json isKindOfClass:[NSDictionary class]]) return NO;
  return JsonFlagIsTrue(json[@"fontButlerTestFeed"]);
}

static NSString *CurrentAgentRequirement(void) {
  return CurrentBuildIsTestFeed() ? kTestAgentRequirement : kReleaseAgentRequirement;
}

static NSString *CurrentAgentLabel(void) {
  return CurrentBuildIsTestFeed() ? kTestAgentLabel : kReleaseAgentLabel;
}

static NSString *CurrentAgentPlistName(void) {
  return [CurrentAgentLabel() stringByAppendingString:@".plist"];
}

static NSString *CurrentServiceName(void) {
  return CurrentBuildIsTestFeed() ? kTestService : kReleaseService;
}

static NSString *CurrentSocketName(void) {
  return CurrentBuildIsTestFeed() ? kTestSocketName : kReleaseSocketName;
}

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

static void DispatchHandoff(NSString *action, NSArray<NSString *> *paths, bool overflow, NSString *requestId) {
  NSLock *lock = HandoffLock();
  [lock lock];
  napi_threadsafe_function tsfn = g_tsfn;
  if (!tsfn) {
    if (!g_queued) g_queued = [NSMutableArray array];
    [g_queued addObject:@{
      @"action" : action ?: @"",
      @"paths" : overflow ? @[] : (paths ?: @[]),
      @"overflow" : @(overflow),
      @"requestId" : requestId ?: @"",
    }];
    [lock unlock];
    return;
  }
  [lock unlock];
  HandoffCall *call = HandoffCallCreate(action, paths, overflow, requestId);
  if (call) napi_call_threadsafe_function(tsfn, call, napi_tsfn_blocking);
}

static int g_listenFd = -1;

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

static BOOL PeerIsAgent(int fd) {
  audit_token_t token;
  memset(&token, 0, sizeof(token));
  socklen_t length = (socklen_t)sizeof(token);
  if (getsockopt(fd, SOL_LOCAL, LOCAL_PEERTOKEN, &token, &length) != 0) return NO;
  if (length != sizeof(token)) return NO;
  return GuestMeetsRequirement(token, CurrentAgentRequirement());
}

// The group-container path does not fit in sockaddr_un.sun_path (104 bytes)
// once a real home directory is included. The socket is in the per-user
// temporary directory, mode 0600, and the peer must be this build's agent.
static BOOL SocketPath(char *out, size_t outSize) {
  if (!out || outSize < 8) return NO;
  char temp[PATH_MAX];
  size_t wrote = confstr(_CS_DARWIN_USER_TEMP_DIR, temp, sizeof(temp));
  if (wrote == 0 || wrote >= sizeof(temp)) return NO;
  const char *separator = temp[strlen(temp) - 1] == '/' ? "" : "/";
  int formatted = snprintf(out, outSize, "%s%s%s", temp, separator, CurrentSocketName().UTF8String);
  if (formatted <= 0 || (size_t)formatted >= outSize) return NO;
  if ((size_t)formatted >= sizeof(((struct sockaddr_un *)0)->sun_path)) return NO;
  return YES;
}

static void ReplyOk(int fd, BOOL ok) {
  NSDictionary *payload = @{@"ok" : @(ok)};
  NSData *json = [NSJSONSerialization dataWithJSONObject:payload options:0 error:nil];
  if (!json || json.length == 0 || json.length > kMaxFrame) return;
  uint32_t length = CFSwapInt32HostToBig((uint32_t)json.length);
  WriteAll(fd, &length, sizeof(length));
  WriteAll(fd, json.bytes, json.length);
}

static void HandleClient(int fd) {
  int yes = 1;
  setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &yes, sizeof(yes));
  struct timeval budget;
  budget.tv_sec = 2;
  budget.tv_usec = 0;
  setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &budget, sizeof(budget));
  if (!PeerIsAgent(fd)) {
    close(fd);
    return;
  }
  uint32_t length = 0;
  if (!ReadAll(fd, &length, sizeof(length))) {
    close(fd);
    return;
  }
  length = CFSwapInt32BigToHost(length);
  if (length == 0 || length > kMaxFrame) {
    close(fd);
    return;
  }
  NSMutableData *data = [NSMutableData dataWithLength:length];
  if (!ReadAll(fd, data.mutableBytes, length)) {
    close(fd);
    return;
  }
  id json = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
  if (![json isKindOfClass:[NSDictionary class]]) {
    ReplyOk(fd, NO);
    close(fd);
    return;
  }
  NSString *action = [json[@"action"] isKindOfClass:[NSString class]] ? json[@"action"] : @"";
  BOOL known = [action isEqualToString:@"install"] || [action isEqualToString:@"installAs"];
  if (!known) {
    ReplyOk(fd, NO);
    close(fd);
    return;
  }
  BOOL overflow = [json[@"overflow"] boolValue];
  NSArray *paths = [json[@"paths"] isKindOfClass:[NSArray class]] ? json[@"paths"] : @[];
  if (!overflow && paths.count > kFinderSyncMaxFiles) overflow = YES;
  NSMutableArray<NSString *> *accepted = [NSMutableArray array];
  if (!overflow) {
    for (id item in paths) {
      if (![item isKindOfClass:[NSString class]]) continue;
      [accepted addObject:item];
    }
  }
  NSString *requestId = [json[@"requestId"] isKindOfClass:[NSString class]] ? json[@"requestId"] : @"";
  DispatchHandoff(action, overflow ? @[] : accepted, overflow, requestId);
  ReplyOk(fd, YES);
  close(fd);
}

static void AcceptLoop(void) {
  int listenFd = g_listenFd;
  while (listenFd >= 0) {
    int client = accept(listenFd, NULL, NULL);
    if (client < 0) {
      if (errno == EINTR) continue;
      if (g_listenFd < 0) return;
      continue;
    }
    HandleClient(client);
  }
}

// The per-user temporary directory must already be a 0700 directory owned
// by this user. Mode on the socket is not how the peer is authenticated.
static BOOL TempDirIsUserPrivate(const char *temp) {
  if (!temp || !temp[0]) return NO;
  struct stat st;
  if (lstat(temp, &st) != 0) return NO;
  if (S_ISLNK(st.st_mode) || !S_ISDIR(st.st_mode)) return NO;
  if (st.st_uid != getuid()) return NO;
  if ((st.st_mode & 0777) != 0700) return NO;
  return YES;
}

static void StartSocket(void) {
  if (g_listenFd >= 0) return;
  signal(SIGPIPE, SIG_IGN);
  char temp[PATH_MAX];
  size_t wrote = confstr(_CS_DARWIN_USER_TEMP_DIR, temp, sizeof(temp));
  if (wrote == 0 || wrote >= sizeof(temp)) return;
  if (!TempDirIsUserPrivate(temp)) return;
  char socketPath[sizeof(((struct sockaddr_un *)0)->sun_path)];
  if (!SocketPath(socketPath, sizeof(socketPath))) return;
  mode_t previousMask = umask(0077);
  struct stat existing;
  if (lstat(socketPath, &existing) == 0) {
    if (S_ISLNK(existing.st_mode) || !S_ISSOCK(existing.st_mode) || existing.st_uid != getuid()) {
      umask(previousMask);
      return;
    }
    unlink(socketPath);
  }
  int fd = socket(AF_UNIX, SOCK_STREAM, 0);
  if (fd < 0) {
    umask(previousMask);
    return;
  }
  fchmod(fd, 0600);
  struct sockaddr_un address;
  memset(&address, 0, sizeof(address));
  address.sun_family = AF_UNIX;
  if (strlcpy(address.sun_path, socketPath, sizeof(address.sun_path)) >= sizeof(address.sun_path)) {
    close(fd);
    umask(previousMask);
    return;
  }
  if (bind(fd, (struct sockaddr *)&address, (socklen_t)sizeof(address)) != 0) {
    close(fd);
    umask(previousMask);
    return;
  }
  fchmod(fd, 0600);
  chmod(socketPath, 0600);
  umask(previousMask);
  if (listen(fd, 16) != 0) {
    close(fd);
    unlink(socketPath);
    return;
  }
  int flags = fcntl(fd, F_GETFD);
  if (flags >= 0) fcntl(fd, F_SETFD, flags | FD_CLOEXEC);
  g_listenFd = fd;
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    AcceptLoop();
  });
}

static NSString *g_lastAgentError = nil;
static BOOL g_didRegisterAgent = NO;

static NSString *JsonString(NSDictionary *payload) {
  NSData *data = [NSJSONSerialization dataWithJSONObject:payload options:0 error:nil];
  if (!data) return @"{\"status\":\"unavailable\"}";
  return [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] ?: @"{\"status\":\"unavailable\"}";
}

// Reads this flavour's SMAppService status. It does not register or unregister.
static NSString *AgentStatusJSON(void) {
  NSString *statusName = @"unsupported";
  NSString *errorText = @"Finder Sync handoff needs macOS 13 so launchd can vend the Mach service.";
  if (@available(macOS 13.0, *)) {
    errorText = g_lastAgentError ?: @"";
    SMAppService *service = [SMAppService agentServiceWithPlistName:CurrentAgentPlistName()];
    SMAppServiceStatus status = service.status;
    if (status == SMAppServiceStatusEnabled) statusName = @"enabled";
    else if (status == SMAppServiceStatusRequiresApproval) statusName = @"requires-approval";
    else if (status == SMAppServiceStatusNotFound) statusName = @"not-found";
    else statusName = @"not-registered";
  }
  return JsonString(@{
    @"status" : statusName,
    @"label" : CurrentAgentLabel(),
    @"service" : CurrentServiceName(),
    @"plist" : CurrentAgentPlistName(),
    @"error" : errorText ?: @"",
  });
}

// One registerAndReturnError per launch, for this flavour's plist only.
static NSString *RegisterAgent(void) {
  if (@available(macOS 13.0, *)) {
    if (!g_didRegisterAgent) {
      g_didRegisterAgent = YES;
      SMAppService *service = [SMAppService agentServiceWithPlistName:CurrentAgentPlistName()];
      NSError *error = nil;
      if (service.status != SMAppServiceStatusEnabled) {
        BOOL registered = [service registerAndReturnError:&error];
        if (!registered) {
          g_lastAgentError = error.localizedDescription.length ? error.localizedDescription
                                                               : @"SMAppService registration failed.";
        } else {
          g_lastAgentError = nil;
        }
      }
    }
  }
  return AgentStatusJSON();
}

static NSString *UnregisterAgent(void) {
  g_didRegisterAgent = NO;
  if (@available(macOS 13.0, *)) {
    SMAppService *service = [SMAppService agentServiceWithPlistName:CurrentAgentPlistName()];
    NSError *error = nil;
    BOOL removed = [service unregisterAndReturnError:&error];
    if (!removed && service.status != SMAppServiceStatusNotRegistered) {
      g_lastAgentError = error.localizedDescription.length ? error.localizedDescription
                                                           : @"SMAppService unregister failed.";
    } else {
      g_lastAgentError = nil;
    }
  }
  return AgentStatusJSON();
}

static NSString *OpenLoginItems(void) {
  if (@available(macOS 13.0, *)) {
    [SMAppService openSystemSettingsLoginItems];
    return @"{\"ok\":true}";
  }
  return @"{\"ok\":false,\"error\":\"Finder Sync login items need macOS 13.\"}";
}

static napi_value JsString(napi_env env, const char *text) {
  napi_value value;
  napi_create_string_utf8(env, text ? text : "", NAPI_AUTO_LENGTH, &value);
  return value;
}

static void CallJs(napi_env env, napi_value js_callback, void *context, void *data) {
  (void)context;
  HandoffCall *call = (HandoffCall *)data;
  if (!env || !js_callback || !call) {
    HandoffCallDestroy(call);
    return;
  }
  napi_value payload;
  napi_create_object(env, &payload);
  napi_set_named_property(env, payload, "action", JsString(env, call->action));
  napi_set_named_property(env, payload, "requestId", JsString(env, call->requestId));

  napi_value paths;
  napi_create_array_with_length(env, call->count, &paths);
  for (uint32_t i = 0; i < call->count; i += 1) {
    napi_set_element(env, paths, i, JsString(env, call->paths[i]));
  }
  napi_set_named_property(env, payload, "paths", paths);
  napi_set_named_property(env, payload, "overflow", JsString(env, call->overflow ? "files" : ""));

  napi_value argv[1] = {payload};
  napi_value undefined;
  napi_get_undefined(env, &undefined);
  napi_value result;
  napi_call_function(env, undefined, js_callback, 1, argv, &result);
  HandoffCallDestroy(call);
}

static napi_value Register(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  napi_value undefined;
  napi_get_undefined(env, &undefined);
  if (argc < 1) return undefined;
  napi_valuetype type = napi_undefined;
  napi_typeof(env, argv[0], &type);
  if (type != napi_function) return undefined;

  StartSocket();

  if (g_tsfn) {
    napi_release_threadsafe_function(g_tsfn, napi_tsfn_release);
    g_tsfn = nullptr;
  }

  napi_value resource_name;
  napi_create_string_utf8(env, "FontButlerFinderSyncReceiver", NAPI_AUTO_LENGTH, &resource_name);
  napi_threadsafe_function created = nullptr;
  napi_create_threadsafe_function(env, argv[0], nullptr, resource_name, 0, 1, nullptr, nullptr, nullptr, CallJs, &created);
  if (created) napi_unref_threadsafe_function(env, created);

  NSLock *lock = HandoffLock();
  [lock lock];
  g_tsfn = created;
  NSArray<NSDictionary *> *queued = g_queued;
  g_queued = nil;
  [lock unlock];
  for (NSDictionary *item in queued) {
    HandoffCall *call = HandoffCallCreate(item[@"action"], item[@"paths"], [item[@"overflow"] boolValue], item[@"requestId"]);
    if (call && g_tsfn) napi_call_threadsafe_function(g_tsfn, call, napi_tsfn_blocking);
    else HandoffCallDestroy(call);
  }
  return undefined;
}

static napi_value AgentStatus(napi_env env, napi_callback_info info) {
  (void)info;
  return JsString(env, AgentStatusJSON().UTF8String);
}

static napi_value RegisterAgentExport(napi_env env, napi_callback_info info) {
  (void)info;
  return JsString(env, RegisterAgent().UTF8String);
}

static napi_value UnregisterAgentExport(napi_env env, napi_callback_info info) {
  (void)info;
  return JsString(env, UnregisterAgent().UTF8String);
}

static napi_value OpenLoginItemsExport(napi_env env, napi_callback_info info) {
  (void)info;
  return JsString(env, OpenLoginItems().UTF8String);
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_value registerFn;
  napi_create_function(env, "register", NAPI_AUTO_LENGTH, Register, nullptr, &registerFn);
  napi_set_named_property(env, exports, "register", registerFn);
  napi_value statusFn;
  napi_create_function(env, "agentStatus", NAPI_AUTO_LENGTH, AgentStatus, nullptr, &statusFn);
  napi_set_named_property(env, exports, "agentStatus", statusFn);
  napi_value registerAgentFn;
  napi_create_function(env, "registerAgent", NAPI_AUTO_LENGTH, RegisterAgentExport, nullptr, &registerAgentFn);
  napi_set_named_property(env, exports, "registerAgent", registerAgentFn);
  napi_value unregisterAgentFn;
  napi_create_function(env, "unregisterAgent", NAPI_AUTO_LENGTH, UnregisterAgentExport, nullptr, &unregisterAgentFn);
  napi_set_named_property(env, exports, "unregisterAgent", unregisterAgentFn);
  napi_value openLoginItemsFn;
  napi_create_function(env, "openLoginItems", NAPI_AUTO_LENGTH, OpenLoginItemsExport, nullptr, &openLoginItemsFn);
  napi_set_named_property(env, exports, "openLoginItems", openLoginItemsFn);
  return exports;
}

static napi_module finder_sync_receiver_module = {
    1, 0, __FILE__, Init, "finder_sync_receiver", nullptr, {0, 0, 0, 0},
};

NAPI_C_CTOR(register_finder_sync_receiver_module) { napi_module_register(&finder_sync_receiver_module); }
