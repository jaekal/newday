export default function MyCoursesLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 w-40 bg-gray-200 rounded-lg" />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="h-56 bg-gray-200 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
