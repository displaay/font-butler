#import <CoreText/CoreText.h>
#import <Foundation/Foundation.h>
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>

typedef struct napi_env__ *napi_env;
typedef struct napi_value__ *napi_value;
typedef struct napi_callback_info__ *napi_callback_info;

typedef enum { napi_ok = 0 } napi_status;

typedef napi_value (*napi_callback)(napi_env env, napi_callback_info info);

extern "C" {
napi_status napi_create_function(napi_env env, const char *utf8name, size_t length, napi_callback cb, void *data,
                                 napi_value *result);
napi_status napi_set_named_property(napi_env env, napi_value object, const char *utf8name, napi_value value);
napi_status napi_get_cb_info(napi_env env, napi_callback_info cbinfo, size_t *argc, napi_value *argv,
                             napi_value *this_arg, void **data);
napi_status napi_get_undefined(napi_env env, napi_value *result);
napi_status napi_get_array_length(napi_env env, napi_value value, uint32_t *result);
napi_status napi_get_element(napi_env env, napi_value object, uint32_t index, napi_value *result);
napi_status napi_get_value_string_utf8(napi_env env, napi_value value, char *buf, size_t bufsize, size_t *result);
napi_status napi_create_int32(napi_env env, int32_t value, napi_value *result);
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

static napi_value UnregisterSessionFonts(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  int32_t unregistered = 0;
  uint32_t length = 0;
  if (argc >= 1) {
    napi_get_array_length(env, argv[0], &length);
  }
  for (uint32_t i = 0; i < length; i++) {
    napi_value item;
    if (napi_get_element(env, argv[0], i, &item) != napi_ok) continue;
    char filePath[4096];
    size_t len = 0;
    if (napi_get_value_string_utf8(env, item, filePath, sizeof(filePath), &len) != napi_ok || len == 0) {
      continue;
    }
    NSString *path = [NSString stringWithUTF8String:filePath];
    if (path.length == 0) continue;
    NSURL *url = [NSURL fileURLWithPath:path];
    if (!url) continue;
    if (CTFontManagerUnregisterFontsForURL((__bridge CFURLRef)url, kCTFontManagerScopeSession, NULL)) {
      unregistered += 1;
    }
  }
  napi_value result;
  napi_create_int32(env, unregistered, &result);
  return result;
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(env, "unregisterSessionFonts", NAPI_AUTO_LENGTH, UnregisterSessionFonts, nullptr, &fn);
  napi_set_named_property(env, exports, "unregisterSessionFonts", fn);
  return exports;
}

static napi_module session_fonts_module = {
    1, 0, __FILE__, Init, "session_fonts", nullptr, {0, 0, 0, 0},
};

NAPI_C_CTOR(register_session_fonts_module) { napi_module_register(&session_fonts_module); }
