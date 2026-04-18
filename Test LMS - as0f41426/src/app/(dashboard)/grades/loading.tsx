export default function GradesLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 w-36 bg-gray-200 rounded-lg" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-24 bg-gray-200 rounded-xl" />
        ))}
      </div>
      <div className="h-64 bg-gray-200 rounded-xl" />
    </div>
  );
}
