export {};

declare global {
  var __diligentJobs: Set<Promise<unknown>> | undefined;
  var __diligentPool: Promise<string[]> | null | undefined;
}
