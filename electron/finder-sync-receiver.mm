#import <Cocoa/Cocoa.h>
#import <CoreServices/CoreServices.h>
#import <Security/Security.h>
#include <bsm/libbsm.h>
#include <stddef.h>
#include <stdint.h>
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
napi_status napi_get_boolean(napi_env env, bool value, napi_value *result);
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

// 'FBFS' / 'hand', action keyword 'FBAc', sender audit token 'tokn'.
static const AEEventClass kFinderSyncEventClass = 0x46424653;
static const AEEventID kFinderSyncEventID = 0x68616e64;
static const AEKeyword kFinderSyncActionKeyword = 0x46424163;
static const AEKeyword kFinderSyncSenderAuditToken = 0x746f6b6e;
static const char *kFinderSyncTeamID = "A7WWML89LQ";
static const char *kFinderSyncBundleID = "app.fontbutler.desktop.FinderSync";
static const char *kFinderSyncTestBundleID = "app.fontbutler.desktop.FinderSync.Test";

static napi_threadsafe_function g_tsfn = nullptr;
static NSMutableArray<NSDictionary *> *g_queued = nil;
static AEEventHandlerUPP g_previousOdoc = NULL;
static SRefCon g_previousOdocRefcon = 0;
static AEEventHandlerUPP g_odocUPP = NULL;

typedef struct {
  char *action;
  char **paths;
  size_t count;
  bool valid;
  bool adhoc;
  char *teamId;
  char *bundleId;
} HandoffCall;

static char *DupCString(const char *value) {
  return strdup(value ? value : "");
}

static HandoffCall *HandoffCallCreate(NSString *action, NSArray<NSString *> *paths, bool valid, bool adhoc,
                                      NSString *teamId, NSString *bundleId) {
  HandoffCall *call = (HandoffCall *)calloc(1, sizeof(HandoffCall));
  if (!call) return nullptr;
  call->action = DupCString(action.UTF8String);
  call->count = paths.count;
  call->paths = call->count ? (char **)calloc(call->count, sizeof(char *)) : nullptr;
  for (size_t i = 0; i < call->count; i += 1) {
    call->paths[i] = DupCString(paths[i].UTF8String);
  }
  call->valid = valid;
  call->adhoc = adhoc;
  call->teamId = DupCString(teamId.UTF8String);
  call->bundleId = DupCString(bundleId.UTF8String);
  return call;
}

static void HandoffCallDestroy(HandoffCall *call) {
  if (!call) return;
  free(call->action);
  for (size_t i = 0; i < call->count; i += 1) free(call->paths[i]);
  free(call->paths);
  free(call->teamId);
  free(call->bundleId);
  free(call);
}

static void CopyCFString(CFTypeRef value, char *dest, size_t destLen) {
  if (!dest || destLen == 0) return;
  dest[0] = 0;
  if (!value || CFGetTypeID(value) != CFStringGetTypeID()) return;
  CFStringGetCString((CFStringRef)value, dest, (CFIndex)destLen, kCFStringEncodingUTF8);
}

// Signature of the process that sent the event. The audit token is the sender.
// A process id is not used: it can be recycled before this runs.
static void VerifySender(const AppleEvent *event, bool *valid, bool *adhoc, char *teamId, size_t teamLen, char *bundleId,
                         size_t bundleLen) {
  if (valid) *valid = false;
  if (adhoc) *adhoc = false;
  if (teamId && teamLen) teamId[0] = 0;
  if (bundleId && bundleLen) bundleId[0] = 0;
  if (!event) return;

  audit_token_t token;
  memset(&token, 0, sizeof(token));
  DescType actualType = typeWildCard;
  Size actualSize = 0;
  OSErr attrErr = AEGetAttributePtr(event, kFinderSyncSenderAuditToken, typeWildCard, &actualType, &token, sizeof(token),
                                    &actualSize);
  if (attrErr != noErr || actualSize != (Size)sizeof(token)) return;

  CFDataRef auditData = CFDataCreate(kCFAllocatorDefault, (const UInt8 *)&token, (CFIndex)sizeof(token));
  if (!auditData) return;
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
  if (copyStatus != errSecSuccess || !guest) return;

  OSStatus signatureStatus = SecCodeCheckValidity(guest, kSecCSDefaultFlags, NULL);
  if (valid) *valid = signatureStatus == errSecSuccess;

  CFDictionaryRef info = NULL;
  if (SecCodeCopySigningInformation(guest, kSecCSSigningInformation, &info) == errSecSuccess && info) {
    CopyCFString(CFDictionaryGetValue(info, kSecCodeInfoTeamIdentifier), teamId, teamLen);
    CopyCFString(CFDictionaryGetValue(info, kSecCodeInfoIdentifier), bundleId, bundleLen);
    CFTypeRef flagsRef = CFDictionaryGetValue(info, kSecCodeInfoFlags);
    if (flagsRef && CFGetTypeID(flagsRef) == CFNumberGetTypeID()) {
      uint32_t flags = 0;
      CFNumberGetValue((CFNumberRef)flagsRef, kCFNumberSInt32Type, &flags);
      if ((flags & kSecCodeSignatureAdhoc) != 0 && adhoc) *adhoc = true;
    }
    CFRelease(info);
  }
  if (adhoc && *adhoc && valid) *valid = false;
  CFRelease(guest);
}

static BOOL SenderIsFinderSyncAppex(bool valid, bool adhoc, const char *teamId, const char *bundleId) {
  if (!valid || adhoc || !teamId || !bundleId) return NO;
  if (strcmp(teamId, kFinderSyncTeamID) != 0) return NO;
  if (strcmp(bundleId, kFinderSyncBundleID) == 0) return YES;
  if (strcmp(bundleId, kFinderSyncTestBundleID) == 0) return YES;
  return NO;
}

static NSString *PathFromDescriptor(NSAppleEventDescriptor *item) {
  if (!item) return nil;
  NSURL *url = item.fileURLValue;
  if (url.isFileURL && url.path.length) return url.path;
  NSString *text = item.stringValue;
  if (text.length && [text hasPrefix:@"/"]) return text;
  return nil;
}

static NSArray<NSString *> *PathsFromEvent(NSAppleEventDescriptor *event) {
  NSMutableArray<NSString *> *paths = [NSMutableArray array];
  NSAppleEventDescriptor *direct = [event paramDescriptorForKeyword:keyDirectObject];
  if (!direct) return paths;
  NSInteger count = direct.numberOfItems;
  if (count > 0) {
    for (NSInteger index = 1; index <= count; index += 1) {
      NSString *path = PathFromDescriptor([direct descriptorAtIndex:index]);
      if (path.length) [paths addObject:path];
    }
    return paths;
  }
  NSString *path = PathFromDescriptor(direct);
  if (path.length) [paths addObject:path];
  return paths;
}

static void DispatchHandoff(NSString *action, NSArray<NSString *> *paths, bool valid, bool adhoc, NSString *teamId,
                            NSString *bundleId) {
  if (g_tsfn) {
    HandoffCall *call = HandoffCallCreate(action, paths, valid, adhoc, teamId, bundleId);
    if (call) napi_call_threadsafe_function(g_tsfn, call, napi_tsfn_blocking);
    return;
  }
  if (!g_queued) g_queued = [NSMutableArray array];
  [g_queued addObject:@{
    @"action" : action ?: @"",
    @"paths" : paths ?: @[],
    @"valid" : @(valid),
    @"adhoc" : @(adhoc),
    @"teamId" : teamId ?: @"",
    @"bundleId" : bundleId ?: @"",
  }];
}

static void ReceiveFinderSyncEvent(const AppleEvent *event) {
  bool valid = false;
  bool adhoc = false;
  char teamId[128];
  char bundleId[256];
  teamId[0] = 0;
  bundleId[0] = 0;
  VerifySender(event, &valid, &adhoc, teamId, sizeof(teamId), bundleId, sizeof(bundleId));
  NSAppleEventDescriptor *desc = [[NSAppleEventDescriptor alloc] initWithAEDesc:event];
  NSString *action = [desc paramDescriptorForKeyword:kFinderSyncActionKeyword].stringValue ?: @"";
  NSArray<NSString *> *paths = PathsFromEvent(desc);
  DispatchHandoff(action, paths, valid, adhoc, [NSString stringWithUTF8String:teamId],
                  [NSString stringWithUTF8String:bundleId]);
}

static OSErr HandleFinderSyncEvent(const AppleEvent *event, AppleEvent *reply, SRefCon refcon) {
  (void)reply;
  (void)refcon;
  @autoreleasepool {
    ReceiveFinderSyncEvent(event);
  }
  return noErr;
}

// A file open from our appex is the same click as the handoff event.
// Finder and everyone else still reach the previous open-documents handler.
static OSErr HandleOpenDocuments(const AppleEvent *event, AppleEvent *reply, SRefCon refcon) {
  (void)refcon;
  bool valid = false;
  bool adhoc = false;
  char teamId[128];
  char bundleId[256];
  teamId[0] = 0;
  bundleId[0] = 0;
  @autoreleasepool {
    VerifySender(event, &valid, &adhoc, teamId, sizeof(teamId), bundleId, sizeof(bundleId));
  }
  if (SenderIsFinderSyncAppex(valid, adhoc, teamId, bundleId)) return noErr;
  if (g_previousOdoc) return g_previousOdoc(event, reply, g_previousOdocRefcon);
  return errAEEventNotHandled;
}

static void InstallHandlers(void) {
  static AEEventHandlerUPP handoffUPP = NULL;
  if (!handoffUPP) handoffUPP = NewAEEventHandlerUPP(HandleFinderSyncEvent);
  AEInstallEventHandler(kFinderSyncEventClass, kFinderSyncEventID, handoffUPP, 0, false);

  AEEventHandlerUPP current = NULL;
  SRefCon currentRef = 0;
  if (AEGetEventHandler(kCoreEventClass, kAEOpenDocuments, &current, &currentRef, false) == noErr) {
    if (current && current != g_odocUPP) {
      g_previousOdoc = current;
      g_previousOdocRefcon = currentRef;
    }
  }
  if (!g_odocUPP) g_odocUPP = NewAEEventHandlerUPP(HandleOpenDocuments);
  AEInstallEventHandler(kCoreEventClass, kAEOpenDocuments, g_odocUPP, 0, false);
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

  napi_value sender;
  napi_create_object(env, &sender);
  napi_value valid;
  napi_value adhoc;
  napi_get_boolean(env, call->valid, &valid);
  napi_get_boolean(env, call->adhoc, &adhoc);
  napi_set_named_property(env, sender, "valid", valid);
  napi_set_named_property(env, sender, "adhoc", adhoc);
  napi_set_named_property(env, sender, "teamId", JsString(env, call->teamId));
  napi_set_named_property(env, sender, "bundleId", JsString(env, call->bundleId));
  napi_set_named_property(env, payload, "sender", sender);

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

  InstallHandlers();

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
    HandoffCall *call = HandoffCallCreate(item[@"action"], item[@"paths"], [item[@"valid"] boolValue],
                                          [item[@"adhoc"] boolValue], item[@"teamId"], item[@"bundleId"]);
    if (call && g_tsfn) napi_call_threadsafe_function(g_tsfn, call, napi_tsfn_blocking);
    else HandoffCallDestroy(call);
  }
  return undefined;
}

static napi_value Init(napi_env env, napi_value exports) {
  InstallHandlers();
  napi_value registerFn;
  napi_create_function(env, "register", NAPI_AUTO_LENGTH, Register, nullptr, &registerFn);
  napi_set_named_property(env, exports, "register", registerFn);
  return exports;
}

static napi_module finder_sync_receiver_module = {
    1, 0, __FILE__, Init, "finder_sync_receiver", nullptr, {0, 0, 0, 0},
};

NAPI_C_CTOR(register_finder_sync_receiver_module) { napi_module_register(&finder_sync_receiver_module); }
