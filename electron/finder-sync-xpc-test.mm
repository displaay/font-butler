#import <Cocoa/Cocoa.h>
#import <Security/Security.h>
#include <stdio.h>

// The release requirement. A process that is not the Finder Sync appex must fail it.
static NSString *const kReleaseRequirement =
    @"anchor apple generic and certificate leaf[subject.OU] = \"A7WWML89LQ\" and identifier \"app.fontbutler.desktop.FinderSync\"";

static BOOL RequirementParses(NSString *text) {
  SecRequirementRef requirement = NULL;
  OSStatus status = SecRequirementCreateWithString((__bridge CFStringRef)text, kSecCSDefaultFlags, &requirement);
  if (requirement) CFRelease(requirement);
  return status == errSecSuccess && requirement != NULL;
}

static BOOL SelfMeetsRequirement(NSString *text) {
  SecRequirementRef requirement = NULL;
  if (SecRequirementCreateWithString((__bridge CFStringRef)text, kSecCSDefaultFlags, &requirement) != errSecSuccess || !requirement) {
    return NO;
  }
  SecCodeRef selfCode = NULL;
  OSStatus selfStatus = SecCodeCopySelf(kSecCSDefaultFlags, &selfCode);
  if (selfStatus != errSecSuccess || !selfCode) {
    CFRelease(requirement);
    return NO;
  }
  OSStatus check = SecCodeCheckValidity(selfCode, kSecCSStrictValidate, requirement);
  CFRelease(selfCode);
  CFRelease(requirement);
  return check == errSecSuccess;
}

static BOOL GuestMeetsRequirement(audit_token_t token, NSString *requirementString) {
  SecRequirementRef requirement = NULL;
  if (SecRequirementCreateWithString((__bridge CFStringRef)requirementString, kSecCSDefaultFlags, &requirement) != errSecSuccess ||
      !requirement) {
    return NO;
  }
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

@interface FinderSyncRejectionProbe : NSObject <NSXPCListenerDelegate, FontButtlerFinderSyncHandoff>
@property(nonatomic, assign) BOOL methodRan;
@end

@implementation FinderSyncRejectionProbe

- (BOOL)listener:(NSXPCListener *)listener shouldAcceptNewConnection:(NSXPCConnection *)connection {
  (void)listener;
  if ([connection respondsToSelector:@selector(setCodeSigningRequirement:)]) {
    [connection setCodeSigningRequirement:kReleaseRequirement];
  }
  if (!GuestMeetsRequirement(connection.auditToken, kReleaseRequirement)) return NO;
  connection.exportedInterface = [NSXPCInterface interfaceWithProtocol:@protocol(FontButtlerFinderSyncHandoff)];
  connection.exportedObject = self;
  [connection resume];
  return YES;
}

- (void)submitAction:(NSString *)action paths:(NSArray<NSString *> *)paths reply:(void (^)(NSString *))reply {
  (void)action;
  (void)paths;
  self.methodRan = YES;
  if (reply) reply(nil);
}

@end

int main(int argc, const char *argv[]) {
  (void)argc;
  (void)argv;
  @autoreleasepool {
    if (!RequirementParses(kReleaseRequirement)) {
      fprintf(stderr, "requirement string did not parse\n");
      return 1;
    }
    if (SelfMeetsRequirement(kReleaseRequirement)) {
      fprintf(stderr, "this process unexpectedly satisfied the Finder Sync requirement\n");
      return 1;
    }

    FinderSyncRejectionProbe *probe = [FinderSyncRejectionProbe new];
    NSXPCListener *listener = [NSXPCListener anonymousListener];
    listener.delegate = probe;
    [listener resume];

    NSXPCConnection *connection = [[NSXPCConnection alloc] initWithListenerEndpoint:listener.endpoint];
    connection.remoteObjectInterface = [NSXPCInterface interfaceWithProtocol:@protocol(FontButtlerFinderSyncHandoff)];
    dispatch_semaphore_t done = dispatch_semaphore_create(0);
    __block BOOL rejected = NO;
    connection.interruptionHandler = ^{
      rejected = YES;
      dispatch_semaphore_signal(done);
    };
    connection.invalidationHandler = ^{
      rejected = YES;
      dispatch_semaphore_signal(done);
    };
    [connection resume];
    id<FontButtlerFinderSyncHandoff> remote = [connection remoteObjectProxyWithErrorHandler:^(NSError *error) {
      (void)error;
      rejected = YES;
      dispatch_semaphore_signal(done);
    }];
    [remote submitAction:@"install" paths:@[ @"/tmp/Font.otf" ] reply:^(NSString *error) {
      (void)error;
      dispatch_semaphore_signal(done);
    }];
    dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 3 * NSEC_PER_SEC));
    [connection invalidate];
    [listener invalidate];

    if (probe.methodRan) {
      fprintf(stderr, "wrongly signed client reached submitAction\n");
      return 1;
    }
    if (!rejected) {
      fprintf(stderr, "wrongly signed client was not rejected\n");
      return 1;
    }
    return 0;
  }
}
