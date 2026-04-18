"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await signIn("credentials", { email, password, redirect: false });
    setLoading(false);
    if (res?.error) {
      setError("Invalid email or password");
    } else {
      router.push("/dashboard");
      router.refresh();
    }
  }

  return (
    <div className="min-h-screen flex bg-white">
      {/* Left — dark brand panel */}
      <div className="hidden lg:flex w-1/2 flex-col justify-between p-12" style={{ background: "var(--c-dark)" }}>
        <div className="flex items-center gap-3">
          <svg width="26" height="30" viewBox="0 0 24 28" fill="none" strokeLinecap="round" strokeLinejoin="round">
            <line x1="2"    y1="5.5"  x2="8.5"  y2="5.5"  stroke="var(--c-accent)" strokeWidth="1.5" />
            <line x1="15.5" y1="5.5"  x2="22"   y2="5.5"  stroke="var(--c-accent)" strokeWidth="1.5" />
            <path d="M 8.5,5.5 A 3.5,3 0 0,1 15.5,5.5" stroke="var(--c-accent)" strokeWidth="1.5" fill="none" />
            <circle cx="12" cy="2.8" r="1" stroke="var(--c-accent)" strokeWidth="1.5" fill="none" />
            <line x1="2.5"  y1="7.5"  x2="21.5" y2="7.5"  stroke="var(--c-accent)" strokeWidth="1.5" />
            <line x1="2.5"  y1="9"    x2="21.5" y2="9"    stroke="var(--c-accent)" strokeWidth="1.5" />
            <line x1="12"   y1="5.5"  x2="12"   y2="26"   stroke="var(--c-accent)" strokeWidth="1.5" />
            <path d="M 5.5,11.5 L 2,17.5 L 9,17.5 Z" stroke="var(--c-accent)" strokeWidth="1.5" fill="none" />
            <line x1="5.5"  y1="11.5" x2="5.5"  y2="25.5" stroke="var(--c-accent)" strokeWidth="1.5" />
            <line x1="1.5"  y1="19.5" x2="22.5" y2="19.5" stroke="var(--c-accent)" strokeWidth="1.5" />
            <circle cx="12" cy="19.5" r="3.5" stroke="var(--c-accent)" strokeWidth="1.5" fill="none" />
            <path d="M 17.2,14 Q 19,11.8 20.8,14" stroke="var(--c-accent)" strokeWidth="1.5" fill="none" />
            <circle cx="19" cy="16"   r="2"   stroke="var(--c-accent)" strokeWidth="1.5" fill="none" />
            <line x1="19"   y1="18"   x2="19"  y2="25.5" stroke="var(--c-accent)" strokeWidth="1.5" />
            <line x1="1.5"  y1="25"   x2="22.5" y2="25"  stroke="var(--c-accent)" strokeWidth="1.5" />
            <line x1="1.5"  y1="26.5" x2="22.5" y2="26.5" stroke="var(--c-accent)" strokeWidth="1.5" />
          </svg>
          <span className="font-black text-xl tracking-tight text-white">MasteryOps</span>
        </div>

        <div className="space-y-6">
          <p className="text-5xl font-black tracking-tight text-white leading-tight">
            What does your<br />
            <span style={{ color: "var(--c-accent)" }}>learning shape</span><br />
            look like?
          </p>
          <p className="text-white/40 text-sm max-w-xs leading-relaxed">
            Every student has a different skill web. Start building yours.
          </p>
        </div>

      </div>

      {/* Right — form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-sm space-y-8">
          {/* Mobile brand mark */}
          <div className="lg:hidden flex items-center gap-2.5">
            <svg width="22" height="26" viewBox="0 0 24 28" fill="none" strokeLinecap="round" strokeLinejoin="round">
              <line x1="2"    y1="5.5"  x2="8.5"  y2="5.5"  stroke="var(--c-dark)" strokeWidth="1.5" />
              <line x1="15.5" y1="5.5"  x2="22"   y2="5.5"  stroke="var(--c-dark)" strokeWidth="1.5" />
              <path d="M 8.5,5.5 A 3.5,3 0 0,1 15.5,5.5" stroke="var(--c-dark)" strokeWidth="1.5" fill="none" />
              <circle cx="12" cy="2.8" r="1" stroke="var(--c-dark)" strokeWidth="1.5" fill="none" />
              <line x1="2.5"  y1="7.5"  x2="21.5" y2="7.5"  stroke="var(--c-dark)" strokeWidth="1.5" />
              <line x1="2.5"  y1="9"    x2="21.5" y2="9"    stroke="var(--c-dark)" strokeWidth="1.5" />
              <line x1="12"   y1="5.5"  x2="12"   y2="26"   stroke="var(--c-dark)" strokeWidth="1.5" />
              <path d="M 5.5,11.5 L 2,17.5 L 9,17.5 Z" stroke="var(--c-dark)" strokeWidth="1.5" fill="none" />
              <line x1="5.5"  y1="11.5" x2="5.5"  y2="25.5" stroke="var(--c-dark)" strokeWidth="1.5" />
              <line x1="1.5"  y1="19.5" x2="22.5" y2="19.5" stroke="var(--c-dark)" strokeWidth="1.5" />
              <circle cx="12" cy="19.5" r="3.5" stroke="var(--c-dark)" strokeWidth="1.5" fill="none" />
              <path d="M 17.2,14 Q 19,11.8 20.8,14" stroke="var(--c-dark)" strokeWidth="1.5" fill="none" />
              <circle cx="19" cy="16"   r="2"   stroke="var(--c-dark)" strokeWidth="1.5" fill="none" />
              <line x1="19"   y1="18"   x2="19"  y2="25.5" stroke="var(--c-dark)" strokeWidth="1.5" />
              <line x1="1.5"  y1="25"   x2="22.5" y2="25"  stroke="var(--c-dark)" strokeWidth="1.5" />
              <line x1="1.5"  y1="26.5" x2="22.5" y2="26.5" stroke="var(--c-dark)" strokeWidth="1.5" />
            </svg>
            <span className="font-black text-lg tracking-tight text-[#111111]">MasteryOps</span>
          </div>

          <div>
            <h1 className="text-3xl font-black tracking-tight text-[#111111]">Sign in</h1>
            <p className="text-[#888888] mt-1 text-sm">Welcome back.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
                {error}
              </div>
            )}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-[#111111]">Email</label>
              <Input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-[#111111]">Password</label>
              <Input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full h-10" disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Sign in
            </Button>
          </form>

          <p className="text-center text-sm text-[#888888]">
            No account?{" "}
            <Link href="/register" className="text-[#111111] hover:underline font-semibold">
              Register
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
