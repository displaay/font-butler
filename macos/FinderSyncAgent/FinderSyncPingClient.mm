#import <Cocoa/Cocoa.h>
#include <stdio.h>

@protocol FontButtlerFinderSyncHandoff
- (void)pingWithReply:(void (^)(NSString *error))reply;
- (void)submitAction:(NSString *)action
               paths:(NSArray<NSString *> *)paths
           requestId:(NSString *)requestId
               reply:(void (^)(NSString *error))reply;
@end

// Connects to the launchd-vended Mach service.
//   finder-sync-ping-client <mach-service>
//   finder-sync-ping-client <mach-service> submit <font-path> <request-id>
// A rejected signature prints "rejected: <reason>" and exits 1.
int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc < 2 || !argv[1] || !argv[1][0]) {
      fprintf(stderr, "usage: finder-sync-ping-client <mach-service> [submit <path> <request-id>]\n");
      return 2;
    }
    BOOL submit = argc >= 5 && argv[2] && strcmp(argv[2], "submit") == 0;
    if (argc >= 3 && !submit) {
      fprintf(stderr, "usage: finder-sync-ping-client <mach-service> [submit <path> <request-id>]\n");
      return 2;
    }
    NSString *service = [NSString stringWithUTF8String:argv[1]];
    NSXPCConnection *connection = [[NSXPCConnection alloc] initWithMachServiceName:service options:0];
    connection.remoteObjectInterface = [NSXPCInterface interfaceWithProtocol:@protocol(FontButtlerFinderSyncHandoff)];
    dispatch_semaphore_t done = dispatch_semaphore_create(0);
    __block BOOL settled = NO;
    __block int status = 1;
    void (^reject)(NSError *error) = ^(NSError *error) {
      if (settled) return;
      settled = YES;
      NSString *reason = error.localizedDescription.length ? error.localizedDescription : @"connection invalidated";
      fprintf(stderr, "rejected: %s\n", reason.UTF8String);
      status = 1;
      dispatch_semaphore_signal(done);
    };
    connection.interruptionHandler = ^{
      reject(nil);
    };
    connection.invalidationHandler = ^{
      reject(nil);
    };
    [connection resume];
    id<FontButtlerFinderSyncHandoff> remote = [connection remoteObjectProxyWithErrorHandler:^(NSError *error) {
      reject(error);
    }];
    if (submit) {
      NSString *fontPath = [NSString stringWithUTF8String:argv[3]];
      NSString *requestId = [NSString stringWithUTF8String:argv[4]];
      [remote submitAction:@"install" paths:@[fontPath] requestId:requestId reply:^(NSString *error) {
        if (settled) return;
        settled = YES;
        if (error.length) {
          fprintf(stderr, "submit error: %s\n", error.UTF8String);
          status = 1;
        } else {
          fprintf(stdout, "submit ok\n");
          status = 0;
        }
        dispatch_semaphore_signal(done);
      }];
    } else {
      [remote pingWithReply:^(NSString *error) {
        if (settled) return;
        settled = YES;
        if (error.length) {
          fprintf(stderr, "ping error: %s\n", error.UTF8String);
          status = 1;
        } else {
          fprintf(stdout, "ping ok\n");
          status = 0;
        }
        dispatch_semaphore_signal(done);
      }];
    }
    dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, (submit ? 30 : 15) * NSEC_PER_SEC));
    int result = status;
    [connection invalidate];
    return result;
  }
}
