// Side-effect module: install process-level guards BEFORE any other app module loads.
// Must be the first app import in index.ts (after dotenv) — ES module bodies execute in import
// order, so this runs before routers.ts's module-level boot IIFEs.
import { installProcessGuards } from "./boot";

installProcessGuards();
