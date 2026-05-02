export { auth as middleware } from "@/auth";

export const config = {
  matcher: ["/dashboard/:path*", "/clientes/:path*", "/proyectos/:path*"],
};
