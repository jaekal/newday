import Link from "next/link";

export default function GlobalNotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center space-y-4">
        <p className="text-7xl font-bold text-gray-200">404</p>
        <h1 className="text-2xl font-bold text-gray-900">Page not found</h1>
        <p className="text-gray-500">The page you&apos;re looking for doesn&apos;t exist.</p>
        <Link
          href="/dashboard"
          className="inline-flex items-center px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}
