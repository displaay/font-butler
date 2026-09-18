#import <Cocoa/Cocoa.h>
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

static napi_threadsafe_function g_tsfn = nullptr;
static NSMutableArray<NSDictionary *> *g_queued = nil;

typedef struct {
  char *action;
  char **paths;
  size_t count;
} FinderCall;

static FinderCall *FinderCallCreate(NSString *action, NSArray<NSString *> *paths) {
  FinderCall *call = (FinderCall *)calloc(1, sizeof(FinderCall));
  if (!call) return nullptr;
  call->action = action ? strdup(action.UTF8String) : strdup("install");
  call->count = paths.count;
  call->paths = call->count ? (char **)calloc(call->count, sizeof(char *)) : nullptr;
  for (size_t i = 0; i < call->count; i += 1) {
    call->paths[i] = strdup(paths[i].UTF8String);
  }
  return call;
}

static void FinderCallDestroy(FinderCall *call) {
  if (!call) return;
  free(call->action);
  for (size_t i = 0; i < call->count; i += 1) free(call->paths[i]);
  free(call->paths);
  free(call);
}

static NSArray<NSString *> *PathsFromPasteboard(NSPasteboard *pboard) {
  NSMutableArray<NSString *> *paths = [NSMutableArray array];
  NSArray *filenames = [pboard propertyListForType:NSFilenamesPboardType];
  if ([filenames isKindOfClass:[NSArray class]]) {
    for (id item in filenames) {
      if ([item isKindOfClass:[NSString class]]) [paths addObject:item];
    }
  }
  if (paths.count == 0) {
    NSArray *urls = [pboard readObjectsForClasses:@[[NSURL class]]
                                          options:@{NSPasteboardURLReadingFileURLsOnlyKey : @YES}];
    for (NSURL *url in urls) {
      if (url.isFileURL && url.path.length) [paths addObject:url.path];
    }
  }
  if (paths.count == 0) {
    NSString *text = [pboard stringForType:NSPasteboardTypeString] ?: [pboard stringForType:NSStringPboardType];
    if (text.length) {
      for (NSString *line in [text componentsSeparatedByCharactersInSet:[NSCharacterSet newlineCharacterSet]]) {
        NSString *trimmed = [line stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
        if (trimmed.length) [paths addObject:trimmed];
      }
    }
  }
  return paths;
}

static void DispatchFinderCall(NSString *action, NSPasteboard *pboard) {
  NSArray<NSString *> *paths = PathsFromPasteboard(pboard);
  if (g_tsfn) {
    FinderCall *call = FinderCallCreate(action, paths);
    if (call) napi_call_threadsafe_function(g_tsfn, call, napi_tsfn_blocking);
    return;
  }
  if (!g_queued) g_queued = [NSMutableArray array];
  [g_queued addObject:@{@"action" : action ?: @"install", @"paths" : paths ?: @[]}];
}

@interface FontButlerFinderServices : NSObject
- (void)installFonts:(NSPasteboard *)pboard userData:(NSString *)userData error:(NSString **)error;
- (void)installFontsAs:(NSPasteboard *)pboard userData:(NSString *)userData error:(NSString **)error;
@end

@implementation FontButlerFinderServices
- (void)installFonts:(NSPasteboard *)pboard userData:(NSString *)userData error:(NSString **)error {
  DispatchFinderCall(@"install", pboard);
}
- (void)installFontsAs:(NSPasteboard *)pboard userData:(NSString *)userData error:(NSString **)error {
  DispatchFinderCall(@"install-as", pboard);
}
@end

static FontButlerFinderServices *g_provider = nil;

static void EnsureProviderRegistered(void) {
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    g_provider = [FontButlerFinderServices new];
    [NSApp setServicesProvider:g_provider];
    NSUpdateDynamicServices();
  });
}

static void CallJs(napi_env env, napi_value js_callback, void *context, void *data) {
  (void)context;
  FinderCall *call = (FinderCall *)data;
  if (!env || !js_callback || !call) {
    FinderCallDestroy(call);
    return;
  }
  napi_value action;
  napi_value paths;
  napi_create_string_utf8(env, call->action ? call->action : "install", NAPI_AUTO_LENGTH, &action);
  napi_create_array_with_length(env, call->count, &paths);
  for (uint32_t i = 0; i < call->count; i += 1) {
    napi_value item;
    napi_create_string_utf8(env, call->paths[i] ? call->paths[i] : "", NAPI_AUTO_LENGTH, &item);
    napi_set_element(env, paths, i, item);
  }
  napi_value argv[2] = {action, paths};
  napi_value undefined;
  napi_get_undefined(env, &undefined);
  napi_value result;
  napi_call_function(env, undefined, js_callback, 2, argv, &result);
  FinderCallDestroy(call);
}

static napi_value Register(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  napi_valuetype type = napi_undefined;
  if (argc < 1) {
    napi_value undefined;
    napi_get_undefined(env, &undefined);
    return undefined;
  }
  napi_typeof(env, argv[0], &type);
  if (type != napi_function) {
    napi_value undefined;
    napi_get_undefined(env, &undefined);
    return undefined;
  }

  EnsureProviderRegistered();

  if (g_tsfn) {
    napi_release_threadsafe_function(g_tsfn, napi_tsfn_release);
    g_tsfn = nullptr;
  }

  napi_value resource_name;
  napi_create_string_utf8(env, "FontButlerFinderServices", NAPI_AUTO_LENGTH, &resource_name);
  napi_create_threadsafe_function(env, argv[0], nullptr, resource_name, 0, 1, nullptr, nullptr, nullptr, CallJs, &g_tsfn);
  if (g_tsfn) napi_unref_threadsafe_function(env, g_tsfn);

  NSArray<NSDictionary *> *queued = g_queued;
  g_queued = nil;
  for (NSDictionary *item in queued) {
    FinderCall *call = FinderCallCreate(item[@"action"], item[@"paths"]);
    if (call && g_tsfn) napi_call_threadsafe_function(g_tsfn, call, napi_tsfn_blocking);
    else FinderCallDestroy(call);
  }

  napi_value undefined;
  napi_get_undefined(env, &undefined);
  return undefined;
}

static napi_value Init(napi_env env, napi_value exports) {
  EnsureProviderRegistered();
  napi_value registerFn;
  napi_create_function(env, "register", NAPI_AUTO_LENGTH, Register, nullptr, &registerFn);
  napi_set_named_property(env, exports, "register", registerFn);
  return exports;
}

static napi_module finder_services_module = {
    1, 0, __FILE__, Init, "finder_services", nullptr, {0, 0, 0, 0},
};

NAPI_C_CTOR(register_finder_services_module) { napi_module_register(&finder_services_module); }
