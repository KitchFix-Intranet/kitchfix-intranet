import { signIn } from "@/lib/auth";

const WELCOME_LINES = [
  "Time to bring the heat.",
  "Step up to the plate.",
  "Let's fire on all burners.",
  "Game time, Chef.",
  "Ready to plate up.",
];

const SUBTITLE_LINES = [
  "Everything your kitchen needs, all in one place.",
  "From lineup cards to labor plans - it starts here.",
  "Your team is waiting. Let's get to work.",
];

function getRotating(arr) {
  const day = new Date().getDate();
  const hour = new Date().getHours();
  return arr[(day + hour) % arr.length];
}

export default function LoginPage() {
  const welcome = getRotating(WELCOME_LINES);
  const subtitle = getRotating(SUBTITLE_LINES);

  return (
    <div className="kf-login">
      <div className="kf-login-card">
        {/* Navy header */}
        <div className="kf-login-card-hero">
          <img
            src="/PFS_PrimaryLogo_White_Circle.png"
            alt="KitchFix Performance Food Service"
            className="kf-login-logo"
          />
          <h1 className="kf-login-brand">KitchFix</h1>
          <p className="kf-login-brand-sub">Performance Food Service</p>
          <p className="kf-login-motto">Best Food. Best Service. Best Hospitality.</p>
        </div>

        {/* White form body */}
        <div className="kf-login-card-body">
          <span className="kf-login-badge">Home Field Operations</span>
          <h2 className="kf-login-welcome">{welcome}</h2>
          <p className="kf-login-desc">{subtitle}</p>

          <form
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: "/" });
            }}
          >
            <button type="submit" className="kf-login-btn">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
              </svg>
              <span>Sign in with Google</span>
            </button>
          </form>

          <p className="kf-login-copy">&copy; 2026 KitchFix Performance Food Service</p>
        </div>
      </div>
    </div>
  );
}