/// <reference types="vite/client" />

declare module "*?sharedworker&worker" {
  const workerConstructor: {
    new (options?: { name?: string }): SharedWorker;
  };
  export default workerConstructor;
}