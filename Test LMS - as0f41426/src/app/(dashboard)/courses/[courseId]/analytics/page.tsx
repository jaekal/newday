"use client";

import { useParams } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Loader2, Users, AlertTriangle, BarChart2, CheckCircle2 } from "lucide-react";
import Link from "next/link";

export default function CourseAnalyticsPage() {
  const { courseId } = useParams<{ courseId: string }>();
  const { data, isLoading } = trpc.course.analytics.useQuery({ courseId });
  const { data: course } = trpc.course.byId.useQuery({ courseId });

  if (isLoading)
    return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>;
  if (!data) return null;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/courses/${courseId}`} className="hover:text-gray-700 flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" />{course?.title ?? "Course"}
        </Link>
        <span className="text-gray-400">/</span>
        <span className="text-gray-900">Analytics</span>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Enrolled" value={data.totalEnrolled} icon={<Users className="h-5 w-5" />} />
        <StatCard label="At Risk" value={data.atRisk.length} icon={<AlertTriangle className="h-5 w-5" />} alert={data.atRisk.length > 0} />
        <StatCard label="Modules" value={data.funnel.length} icon={<BarChart2 className="h-5 w-5" />} />
        <StatCard
          label="Avg Completion"
          value={data.funnel.length > 0
            ? `${Math.round(data.funnel.reduce((s, f) => s + f.pct, 0) / data.funnel.length)}%`
            : "—"}
          icon={<CheckCircle2 className="h-5 w-5" />}
        />
      </div>

      {/* Completion funnel */}
      <Card>
        <CardContent className="p-5 space-y-3">
          <h2 className="font-semibold text-gray-900">Module Completion Funnel</h2>
          {data.funnel.length === 0 && <p className="text-sm text-gray-400">No modules yet.</p>}
          {data.funnel.map((m) => (
            <div key={m.moduleId} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-700 font-medium truncate flex-1 mr-4">
                  {m.order}. {m.title}
                </span>
                <span className="text-gray-500 tabular-nums shrink-0">{m.completed}/{data.totalEnrolled} ({m.pct}%)</span>
              </div>
              <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${m.pct}%`, background: "var(--c-accent)" }}
                />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Assessment stats */}
      {data.assessmentStats.length > 0 && (
        <Card>
          <CardContent className="p-5 space-y-3">
            <h2 className="font-semibold text-gray-900">Assessment Performance</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 uppercase border-b">
                    <th className="pb-2 font-medium">Assessment</th>
                    <th className="pb-2 font-medium text-right">Attempts</th>
                    <th className="pb-2 font-medium text-right">Avg Score</th>
                    <th className="pb-2 font-medium text-right">Pass Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {data.assessmentStats.map((a) => (
                    <tr key={a.id}>
                      <td className="py-2.5 font-medium text-gray-900">{a.title}</td>
                      <td className="py-2.5 text-right text-gray-600">{a.attempts}</td>
                      <td className="py-2.5 text-right text-gray-600">
                        {a.avg !== null ? `${Math.round(a.avg)}%` : "—"}
                      </td>
                      <td className="py-2.5 text-right">
                        {a.passRate !== null ? (
                          <span className={a.passRate >= 0.7 ? "text-green-600 font-medium" : "text-red-500 font-medium"}>
                            {Math.round(a.passRate * 100)}%
                          </span>
                        ) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* At-risk roster */}
      {data.atRisk.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <h2 className="font-semibold text-gray-900">At-Risk Students</h2>
              <Badge className="bg-amber-100 text-amber-700 border-amber-200">No activity in 14+ days</Badge>
            </div>
            <div className="space-y-1">
              {data.atRisk.map((u) => (
                <div key={u.id} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-amber-50">
                  <span className="text-sm font-medium text-gray-900">{u.name}</span>
                  <span className="text-xs text-gray-500">{u.email}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatCard({
  label, value, icon, alert,
}: {
  label: string; value: string | number; icon: React.ReactNode; alert?: boolean;
}) {
  return (
    <Card className={alert ? "border-amber-300 bg-amber-50/50" : ""}>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={cn("h-9 w-9 rounded-lg flex items-center justify-center", alert ? "bg-amber-100 text-amber-600" : "bg-gray-100 text-gray-500")}>
          {icon}
        </div>
        <div>
          <p className="text-xs text-gray-400">{label}</p>
          <p className="text-xl font-bold text-gray-900">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function cn(...classes: (string | undefined | false)[]) {
  return classes.filter(Boolean).join(" ");
}
