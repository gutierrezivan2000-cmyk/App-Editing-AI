import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        username: { label: "Usuario", type: "text" },
        password: { label: "Contraseña", type: "password" },
      },
      async authorize(credentials) {
        const adminUser = process.env.ADMIN_USERNAME ?? "admin";
        const adminPass = process.env.ADMIN_PASSWORD ?? "changeme";

        if (
          credentials?.username === adminUser &&
          credentials?.password === adminPass
        ) {
          return { id: "1", name: adminUser, email: `${adminUser}@agency.local` };
        }
        return null;
      },
    }),
  ],
  pages: {
    signIn: "/login",
  },
  session: { strategy: "jwt" },
  secret: process.env.AUTH_SECRET,
});
