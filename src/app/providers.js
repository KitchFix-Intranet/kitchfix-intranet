"use client";

import { SessionProvider, useSession } from "next-auth/react";
import { useEffect } from "react";

function AuthSync({ children }) {
  const { data: session } = useSession();

  useEffect(() => {
    if (session?.user?.email) {
      localStorage.setItem("kf_user_email", session.user.email);
    }
  }, [session]);

  return children;
}

export default function Providers({ children }) {
  return (
    <SessionProvider>
      <AuthSync>{children}</AuthSync>
    </SessionProvider>
  );
}