#import <Cocoa/Cocoa.h>
#import <Security/Security.h>
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

// One requirement per flavour. The listener accepts that identifier only.
static NSString *const kReleaseRequirement =
    @"anchor apple generic and certificate leaf[subject.OU] = \"A7WWML89LQ\" and identifier \"app.fontbutler.desktop.FinderSync\"";
static NSString *const kTestRequirement =
    @"anchor apple generic and certificate leaf[subject.OU] = \"A7WWML89LQ\" and identifier \"app.fontbutler.desktop.FinderSync.Test\"";
static NSString *const kReleaseService = @"A7WWML89LQ.group.app.fontbutler.desktop.FinderSync";
static NSString *const kTestService = @"A7WWML89LQ.group.app.fontbutler.desktop.FinderSync.Test";
static const NSUInteger kFinderSyncMaxFiles = 500;

static napi_threadsafe_function g_tsfn = nullptr;
static NSMutableArray<NSDictionary *> *g_queued = nil;

typedef struct {
  char *action;
  char **paths;
  size_t count;
  bool overflow;
} HandoffCall;

static char *DupCString(const char *value) {
  return strdup(value ? value : "");
}

static HandoffCall *HandoffCallCreate(NSString *action, NSArray<NSString *> *paths, bool overflow) {
  HandoffCall *call = (HandoffCall *)calloc(1, sizeof(HandoffCall));
  if (!call) return nullptr;
  call->action = DupCString(action.UTF8String);
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

static NSString *CurrentRequirement(void) {
  return CurrentBuildIsTestFeed() ? kTestRequirement : kReleaseRequirement;
}

static NSString *CurrentServiceName(void) {
  return CurrentBuildIsTestFeed() ? kTestService : kReleaseService;
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

@protocol FontButtlerFinderSyncHandoff
- (void)submitAction:(NSString *)action paths:(NSArray<NSString *> *)paths reply:(void (^)(NSString *error))reply;
@end

@interface FontButtlerFinderSyncListener : NSObject <NSXPCListenerDelegate, FontButtlerFinderSyncHandoff>
@property(nonatomic, strong) NSXPCListener *listener;
@property(nonatomic, copy) NSString *requirement;
@end

static void DispatchHandoff(NSString *action, NSArray<NSString *> *paths, bool overflow) {
  if (g_tsfn) {
    HandoffCall *call = HandoffCallCreate(action, paths, overflow);
    if (call) napi_call_threadsafe_function(g_tsfn, call, napi_tsfn_blocking);
    return;
  }
  if (!g_queued) g_queued = [NSMutableArray array];
  [g_queued addObject:@{
    @"action" : action ?: @"",
    @"paths" : overflow ? @[] : (paths ?: @[]),
    @"overflow" : @(overflow),
  }];
}

@implementation FontButtlerFinderSyncListener

- (void)start {
  if (self.listener) return;
  self.requirement = CurrentRequirement();
  NSXPCListener *listener = [[NSXPCListener alloc] initWithMachServiceName:CurrentServiceName()];
  listener.delegate = self;
  self.listener = listener;
  [listener resume];
}

- (BOOL)listener:(NSXPCListener *)listener shouldAcceptNewConnection:(NSXPCConnection *)connection {
  (void)listener;
  NSString *requirement = self.requirement.length ? self.requirement : CurrentRequirement();
  if ([connection respondsToSelector:@selector(setCodeSigningRequirement:)]) {
    [connection setCodeSigningRequirement:requirement];
  }
  if (!GuestMeetsRequirement(connection.auditToken, requirement)) return NO;
  connection.exportedInterface = [NSXPCInterface interfaceWithProtocol:@protocol(FontButtlerFinderSyncHandoff)];
  connection.exportedObject = self;
  [connection resume];
  return YES;
}

- (void)submitAction:(NSString *)action paths:(NSArray<NSString *> *)paths reply:(void (^)(NSString *))reply {
  NSString *wire = [action isKindOfClass:[NSString class]] ? action : @"";
  BOOL known = [wire isEqualToString:@"install"] || [wire isEqualToString:@"installAs"];
  if (!known) {
    if (reply) reply(@"Unknown Finder Sync action.");
    return;
  }
  NSArray<NSString *> *incoming = [paths isKindOfClass:[NSArray class]] ? paths : @[];
  if (incoming.count > kFinderSyncMaxFiles) {
    DispatchHandoff(wire, @[], true);
    if (reply) reply(nil);
    return;
  }
  DispatchHandoff(wire, incoming, false);
  if (reply) reply(nil);
}

@end

static FontButtlerFinderSyncListener *g_service = nil;

static void StartListener(void) {
  if (g_service) return;
  g_service = [FontButtlerFinderSyncListener new];
  [g_service start];
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

  StartListener();

  if (g_tsfn) {
    napi_release_threadsafe_function(g_tsfn, napi_tsfn_release);
    g_tsfn = nullptr;
  }

  napi_value resource_name;
  napi_create_string_utf8(env, "FontButlerFinderSyncReceiver", NAPI_AUTO_LENGTH, &resource_name);
  napi_create_threadsafe_function(env, argv[0], nullptr, resource_name, 0, 1, nullptr, nullptr, nullptr, CallJs, &g_tsfn);
  if (g_tsfn) napi_unref_threadsafe_function(env, g_tsfn);

  NSArray<NSDictionary *> *queued = g_queued;
  g_queued = nil;
  for (NSDictionary *item in queued) {
    HandoffCall *call = HandoffCallCreate(item[@"action"], item[@"paths"], [item[@"overflow"] boolValue]);
    if (call && g_tsfn) napi_call_threadsafe_function(g_tsfn, call, napi_tsfn_blocking);
    else HandoffCallDestroy(call);
  }
  return undefined;
}

static napi_value Init(napi_env env, napi_value exports) {
  StartListener();
  napi_value registerFn;
  napi_create_function(env, "register", NAPI_AUTO_LENGTH, Register, nullptr, &registerFn);
  napi_set_named_property(env, exports, "register", registerFn);
  return exports;
}

static napi_module finder_sync_receiver_module = {
    1, 0, __FILE__, Init, "finder_sync_receiver", nullptr, {0, 0, 0, 0},
};

NAPI_C_CTOR(register_finder_sync_receiver_module) { napi_module_register(&finder_sync_receiver_module); }
