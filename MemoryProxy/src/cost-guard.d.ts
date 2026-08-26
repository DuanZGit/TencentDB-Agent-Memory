/**
 * Optional private extension. The host drops in a real implementation during
 * internal image builds; open source deployments keep only this declaration so
 * `await import("@context-proxy/cost-guard")` typechecks without the package.
 */
declare module "@context-proxy/cost-guard" {
  export const openKernelStsCosBackend: unknown;
}
