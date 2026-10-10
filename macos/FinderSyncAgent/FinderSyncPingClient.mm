#import <Cocoa/Cocoa.h>
#include <stdio.h>

@protocol FontButtlerFinderSyncHandoff
- (void)pingWithReply:(void (^)(NSString *error))reply;
@end

// Connects to the launchd-vended Mach service and sends one ping.
// A rejected signature fires the error handler and this process exits 1.
int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc < 2 || !argv[1] || !argv[1][0]) {
      fprintf(stderr, "usage: finder-sync-ping-client <mach-service>\n");
      return 2;
    }
    NSString *service = [NSString stringWithUTF8String:argv[1]];
    NSXPCConnection *connection = [[NSXPCConnection alloc] initWithMachServiceName:service options:0];
    connection.remoteObjectInterface = [NSXPCInterface interfaceWithProtocol:@protocol(FontButtlerFinderSyncHandoff)];
    dispatch_semaphore_t done = dispatch_semaphore_create(0);
    __block BOOL settled = NO;
    __block int status = 1;
    void (^reject)(void) = ^{
      if (settled) return;
      settled = YES;
      fprintf(stderr, "rejected\n");
      status = 1;
      dispatch_semaphore_signal(done);
    };
    connection.interruptionHandler = reject;
    connection.invalidationHandler = reject;
    [connection resume];
    id<FontButtlerFinderSyncHandoff> remote = [connection remoteObjectProxyWithErrorHandler:^(NSError *error) {
      (void)error;
      reject();
    }];
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
    dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 15 * NSEC_PER_SEC));
    int result = status;
    [connection invalidate];
    return result;
  }
}
