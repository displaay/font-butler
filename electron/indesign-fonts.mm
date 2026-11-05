/**
 * Ask InDesign which fonts its open documents use.
 *
 * This is Cicero's DocumentFontWatcher ask for com.adobe.InDesign: three
 * get-data Apple Events, sent to the process, for every font of every
 * document (fPSN, fFam, fSty). AppleScript is not used. A Missing Fonts
 * dialog does not change the question; InDesign answers while it is open.
 */
#import <Foundation/Foundation.h>
#import <ApplicationServices/ApplicationServices.h>
#include <stdint.h>
#include <stdlib.h>
#include <string>
#include <vector>

typedef struct napi_env__ *napi_env;
typedef struct napi_value__ *napi_value;
typedef struct napi_callback_info__ *napi_callback_info;
typedef struct napi_async_work__ *napi_async_work;
typedef struct napi_deferred__ *napi_deferred;

typedef enum { napi_ok = 0 } napi_status;

typedef napi_value (*napi_callback)(napi_env env, napi_callback_info info);
typedef void (*napi_async_execute_callback)(napi_env env, void *data);
typedef void (*napi_async_complete_callback)(napi_env env, napi_status status, void *data);

extern "C" {
napi_status napi_create_function(napi_env env, const char *utf8name, size_t length, napi_callback cb, void *data,
                                 napi_value *result);
napi_status napi_set_named_property(napi_env env, napi_value object, const char *utf8name, napi_value value);
napi_status napi_get_cb_info(napi_env env, napi_callback_info cbinfo, size_t *argc, napi_value *argv,
                             napi_value *this_arg, void **data);
napi_status napi_get_value_int32(napi_env env, napi_value value, int32_t *result);
napi_status napi_create_string_utf8(napi_env env, const char *utf8, size_t length, napi_value *result);
napi_status napi_create_array_with_length(napi_env env, size_t length, napi_value *result);
napi_status napi_set_element(napi_env env, napi_value object, uint32_t index, napi_value value);
napi_status napi_create_object(napi_env env, napi_value *result);
napi_status napi_get_boolean(napi_env env, bool value, napi_value *result);
napi_status napi_create_promise(napi_env env, napi_deferred *deferred, napi_value *promise);
napi_status napi_resolve_deferred(napi_env env, napi_deferred deferred, napi_value resolution);
napi_status napi_create_async_work(napi_env env, napi_value async_resource, napi_value async_resource_name,
                                   napi_async_execute_callback execute, napi_async_complete_callback complete,
                                   void *data, napi_async_work *result);
napi_status napi_queue_async_work(napi_env env, napi_async_work work);
napi_status napi_delete_async_work(napi_env env, napi_async_work work);
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

static OSType Four(const char *text) {
  return ((OSType)(unsigned char)text[0] << 24) | ((OSType)(unsigned char)text[1] << 16) |
         ((OSType)(unsigned char)text[2] << 8) | (OSType)(unsigned char)text[3];
}

static NSAppleEventDescriptor *Specifier(OSType desired, OSType form, NSAppleEventDescriptor *data,
                                        NSAppleEventDescriptor *container) {
  NSAppleEventDescriptor *record = [NSAppleEventDescriptor recordDescriptor];
  [record setDescriptor:[NSAppleEventDescriptor descriptorWithTypeCode:desired] forKeyword:keyAEDesiredClass];
  [record setDescriptor:[NSAppleEventDescriptor descriptorWithEnumCode:form] forKeyword:keyAEKeyForm];
  [record setDescriptor:data forKeyword:keyAEKeyData];
  [record setDescriptor:container forKeyword:keyAEContainer];
  return [record coerceToDescriptorType:typeObjectSpecifier];
}

/** `every <class> of <container>`. kAEAll is passed the same way Cicero does. */
static NSAppleEventDescriptor *Every(const char *type, NSAppleEventDescriptor *container) {
  OSType all = kAEAll;
  NSAppleEventDescriptor *data =
      [NSAppleEventDescriptor descriptorWithDescriptorType:typeAbsoluteOrdinal bytes:&all length:sizeof(all)];
  return Specifier(Four(type), formAbsolutePosition, data, container);
}

static NSAppleEventDescriptor *PropertyOf(const char *name, NSAppleEventDescriptor *container) {
  return Specifier(typeProperty, formPropertyID, [NSAppleEventDescriptor descriptorWithTypeCode:Four(name)], container);
}

/** Lists inside lists, one string each. A missing string stays empty so the three lists line up. */
static void CollectStrings(NSAppleEventDescriptor *descriptor, std::vector<std::string> *out) {
  if (descriptor == nil || out == nullptr) return;
  if (descriptor.descriptorType == typeAEList) {
    NSInteger count = descriptor.numberOfItems;
    for (NSInteger index = 1; index <= count; index++) {
      CollectStrings([descriptor descriptorAtIndex:index], out);
    }
    return;
  }
  NSString *text = descriptor.stringValue;
  const char *utf = text.UTF8String;
  out->emplace_back(utf ? utf : "");
}

static void ClearFonts(std::vector<std::string> *names, std::vector<std::string> *families,
                       std::vector<std::string> *styles) {
  names->clear();
  families->clear();
  styles->clear();
}

static bool SendGet(NSAppleEventDescriptor *specifier, pid_t pid, std::vector<std::string> *out, bool *refused) {
  NSAppleEventDescriptor *target = [NSAppleEventDescriptor descriptorWithProcessIdentifier:pid];
  NSAppleEventDescriptor *event = [[NSAppleEventDescriptor alloc] initWithEventClass:kAECoreSuite
                                                                             eventID:kAEGetData
                                                                    targetDescriptor:target
                                                                            returnID:kAutoGenerateReturnID
                                                                       transactionID:kAnyTransactionID];
  [event setParamDescriptor:specifier forKeyword:keyDirectObject];
  NSError *error = nil;
  NSAppleEventDescriptor *reply =
      [event sendEventWithOptions:NSAppleEventSendDefaultOptions timeout:10 error:&error];
  if (reply == nil || error != nil) {
    if (error != nil && error.code == errAEEventNotPermitted) *refused = true;
    return false;
  }
  NSAppleEventDescriptor *status = [reply paramDescriptorForKeyword:keyErrorNumber];
  if (status != nil && status.int32Value != 0) {
    if (status.int32Value == errAEEventNotPermitted) *refused = true;
    return false;
  }
  NSAppleEventDescriptor *direct = [reply paramDescriptorForKeyword:keyDirectObject];
  if (direct == nil) direct = [NSAppleEventDescriptor listDescriptor];
  CollectStrings(direct, out);
  return true;
}

static void AskInDesign(pid_t pid, bool *refused, std::vector<std::string> *names, std::vector<std::string> *families,
                        std::vector<std::string> *styles) {
  *refused = false;
  if (pid <= 0) return;
  @autoreleasepool {
    @try {
      NSAppleEventDescriptor *documents = Every("docu", [NSAppleEventDescriptor nullDescriptor]);
      NSAppleEventDescriptor *fonts = Every("FonT", documents);
      if (!SendGet(PropertyOf("fPSN", fonts), pid, names, refused) || *refused) {
        ClearFonts(names, families, styles);
        return;
      }
      if (!SendGet(PropertyOf("fFam", fonts), pid, families, refused) || *refused) {
        ClearFonts(names, families, styles);
        return;
      }
      if (!SendGet(PropertyOf("fSty", fonts), pid, styles, refused) || *refused) {
        ClearFonts(names, families, styles);
      }
    } @catch (NSException *) {
      ClearFonts(names, families, styles);
    }
  }
}

struct AskRequest {
  pid_t pid = 0;
  bool refused = false;
  std::vector<std::string> names;
  std::vector<std::string> families;
  std::vector<std::string> styles;
  napi_async_work work = nullptr;
  napi_deferred deferred = nullptr;
};

static void ExecuteAsk(napi_env, void *data) {
  auto *request = static_cast<AskRequest *>(data);
  AskInDesign(request->pid, &request->refused, &request->names, &request->families, &request->styles);
}

static napi_value StringArray(napi_env env, const std::vector<std::string> &values) {
  napi_value array;
  napi_create_array_with_length(env, values.size(), &array);
  for (size_t index = 0; index < values.size(); index++) {
    napi_value text;
    napi_create_string_utf8(env, values[index].c_str(), values[index].size(), &text);
    napi_set_element(env, array, static_cast<uint32_t>(index), text);
  }
  return array;
}

static void CompleteAsk(napi_env env, napi_status, void *data) {
  auto *request = static_cast<AskRequest *>(data);
  napi_value result;
  napi_create_object(env, &result);
  napi_value refused;
  napi_get_boolean(env, request->refused, &refused);
  napi_set_named_property(env, result, "refused", refused);
  napi_set_named_property(env, result, "postscriptNames", StringArray(env, request->names));
  napi_set_named_property(env, result, "families", StringArray(env, request->families));
  napi_set_named_property(env, result, "styles", StringArray(env, request->styles));
  napi_resolve_deferred(env, request->deferred, result);
  napi_delete_async_work(env, request->work);
  delete request;
}

static napi_value AskInDesignFonts(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  int32_t pid = 0;
  if (argc >= 1) napi_get_value_int32(env, argv[0], &pid);
  napi_deferred deferred;
  napi_value promise;
  napi_create_promise(env, &deferred, &promise);
  auto *request = new AskRequest();
  request->pid = static_cast<pid_t>(pid);
  request->deferred = deferred;
  napi_value name;
  napi_create_string_utf8(env, "askInDesignFonts", NAPI_AUTO_LENGTH, &name);
  napi_create_async_work(env, nullptr, name, ExecuteAsk, CompleteAsk, request, &request->work);
  napi_queue_async_work(env, request->work);
  return promise;
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_value ask;
  napi_create_function(env, "askInDesignFonts", NAPI_AUTO_LENGTH, AskInDesignFonts, nullptr, &ask);
  napi_set_named_property(env, exports, "askInDesignFonts", ask);
  return exports;
}

static napi_module indesign_fonts_module = {
    1, 0, __FILE__, Init, "indesign_fonts", nullptr, {0, 0, 0, 0},
};

NAPI_C_CTOR(register_indesign_fonts_module) { napi_module_register(&indesign_fonts_module); }
