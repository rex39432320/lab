import { registerAdmin } from './admin.js';
import { registerAi } from './ai.js';
import { registerAnalytics } from './analytics.js';
import { registerAuth } from './auth.js';
import { registerBookings } from './bookings.js';
import { registerEquipment } from './equipment.js';
import { registerNegotiation } from './negotiation.js';
import { registerNotifications } from './notifications.js';
import { registerProjects } from './projects.js';

export function registerRoutes(router, deps) {
  registerAuth(router, deps);
  registerEquipment(router, deps);
  registerBookings(router, deps);
  registerNegotiation(router, deps);
  registerProjects(router, deps);
  registerNotifications(router, deps);
  registerAi(router, deps);
  registerAnalytics(router, deps);
  registerAdmin(router, deps);
}
