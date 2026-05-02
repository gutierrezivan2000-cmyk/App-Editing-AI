import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { sql } from "@vercel/postgres";
import { authConfig } from "./auth.config";

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Contraseña", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        try {
          const email = String(credentials.email);
          const password = String(credentials.password);

          const { rows } = await sql`
            SELECT id, email, name, password FROM users WHERE email = ${email}
          `;

          if (rows.length === 0) {
            return null;
          }

          const user = rows[0] as any;
          const passwordMatch = await compare(password, user.password);

          if (!passwordMatch) {
            return null;
          }

          return {
            id: user.id,
            email: user.email,
            name: user.name || user.email.split("@")[0],
          };
        } catch (error) {
          console.error("Auth error:", error);
          return null;
        }
      },
    }),
  ],
  session: { strategy: "jwt" },
  secret: process.env.AUTH_SECRET,
});
