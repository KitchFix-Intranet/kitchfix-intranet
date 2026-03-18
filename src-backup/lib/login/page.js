import { signIn } from "@/lib/auth";

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-kf-bg flex items-center justify-center p-6">
      <div className="w-full max-w-sm">

        {/* Logo & Brand */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-kf-navy rounded-2xl mb-5">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 11h.01M11 15h.01M16 16c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3" />
              <path d="M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0" />
            </svg>
          </div>
          <h1 className="font-inter text-2xl font-bold text-kf-navy">KitchFix</h1>
          <p className="font-mulish text-sm text-gray-500 mt-1">Intranet Command Center</p>
        </div>

        {/* Sign In Card */}
        <div className="porcelain rounded-kf shadow-porcelain p-8">
          <h2 className="font-inter text-lg font-semibold text-kf-navy text-center mb-2">
            Welcome, Chef.
          </h2>
          <p className="font-mulish text-sm text-gray-500 text-center mb-8">
            Sign in with your KitchFix account to continue.
          </p>

          <form
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: "/" });
            }}
          >
            <button
              type="submit"
              className="squish w-full flex items-center justify-center gap-3 bg-kf-blue hover:bg-blue-700 text-white font-inter font-semibold text-sm py-4 px-6 rounded-pill transition-colors"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              Sign in with Google
            </button>
          </form>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-gray-400 mt-8 font-mulish">
          Every inning, every ingredient, one standard.
        </p>

      </div>
    </div>
  );
}