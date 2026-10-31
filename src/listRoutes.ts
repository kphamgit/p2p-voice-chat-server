import type { Express, RequestHandler, Router } from 'express';

// Express 5 doesn't keep a mount's prefix in readable form, so we can't recover
// "/dialogs/:id" by walking app.router.stack. Instead, mount routers through
// mountRoutes(), which records each prefix alongside its router for printing.
const mounts: { prefix: string; router: Router }[] = [];

// Drop-in for `app.use(prefix, ...middleware, router)`: the router goes last.
export function mountRoutes(app: Express, prefix: string, ...handlers: [...RequestHandler[], Router]): void {
    app.use(prefix, ...handlers);
    mounts.push({ prefix, router: handlers[handlers.length - 1] as Router });
}

// Print "METHOD /full/path" for every route registered via mountRoutes().
export function printRoutes(): void {
    const lines: string[] = [];
    for (const { prefix, router } of mounts) {
        for (const layer of router.stack) {
            const route = layer.route as { path: string; methods?: Record<string, boolean> } | undefined;
            if (!route) continue; // router-level middleware, not an endpoint
            const path = route.path === '/' ? prefix : prefix + route.path;
            for (const method of Object.keys(route.methods ?? {})) {
                lines.push(`  ${method.toUpperCase().padEnd(7)} ${path}`);
            }
        }
    }
    console.log(`📋 Routes (${lines.length}):\n${lines.join('\n')}`);
}
