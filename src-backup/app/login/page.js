import { signIn } from "@/lib/auth";

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-kf-bg flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
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
              Sign in with Google
            </button>
          </form>
        </div>
        <p className="text-center text-xs text-gray-400 mt-8 font-mulish">
          Every inning, every ingredient, one standard.
        </p>
      </div>
    </div>
  );
}