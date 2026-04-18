"use client";

import { useState, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Loader2, ChevronLeft, ChevronRight, Search, Users, Plus, Upload,
  Pencil, KeyRound, X, Check, AlertTriangle, Download, ChevronDown, Power, Trash2, ArrowUpDown,
} from "lucide-react";
import { formatDate } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

type Role = "STUDENT" | "INSTRUCTOR" | "MANAGER" | "ADMIN";
type UserStatus = "ACTIVE" | "INACTIVE";
type SortField = "name" | "email" | "role" | "status" | "createdAt";

const ALL_ROLES = "__all_roles__";
const ALL_STATUSES = "__all_statuses__";

const ROLE_COLORS: Record<string, "secondary" | "success" | "destructive"> = {
  STUDENT: "secondary",
  INSTRUCTOR: "success",
  MANAGER: "success",
  ADMIN: "destructive",
};

type UserRow = {
  id: string;
  name: string | null;
  email: string;
  employeeId: string | null;
  role: Role;
  isActive: boolean;
  createdAt: Date | string;
};

// ─── Inline panel (Add / Edit) ────────────────────────────────────────────────

function UserFormPanel({
  user,
  currentUserRole,
  onClose,
  onSaved,
}: {
  user?: UserRow;
  currentUserRole?: Role;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const isEdit = !!user;

  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [employeeId, setEmployeeId] = useState(user?.employeeId ?? "");
  const [role, setRole] = useState<Role>(user?.role ?? "STUDENT");
  const [password, setPassword] = useState("");
  const canAssignAdmin = currentUserRole !== "MANAGER";

  const createUser = trpc.user.createUser.useMutation({
    onSuccess: () => { toast({ title: "User created", variant: "success" }); onSaved(); },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "error" }),
  });
  const updateUser = trpc.user.updateUser.useMutation({
    onSuccess: () => { toast({ title: "User updated", variant: "success" }); onSaved(); },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "error" }),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isEdit) {
      updateUser.mutate({
        userId: user.id,
        name: name || undefined,
        email: email || undefined,
        role,
        employeeId: employeeId || null,
      });
    } else {
      createUser.mutate({ name, email, password, role, employeeId: employeeId || undefined });
    }
  }

  const isPending = createUser.isPending || updateUser.isPending;

  return (
    <div className="border border-[#e8e8e8] rounded-xl p-5 bg-[#fafafa] space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-black text-sm tracking-tight text-[#111111]">
          {isEdit ? "Edit User" : "New User"}
        </h3>
        <button onClick={onClose} className="text-[#888888] hover:text-[#111111]">
          <X className="h-4 w-4" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-[#555555]">Full Name</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Smith" required />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-[#555555]">Email</label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@example.com" required />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-[#555555]">Employee ID</label>
          <Input value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} placeholder="EMP-001 (optional)" />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-[#555555]">Role</label>
          <Select value={role} onValueChange={(v) => setRole(v as Role)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="STUDENT">Student</SelectItem>
              <SelectItem value="INSTRUCTOR">Instructor</SelectItem>
              <SelectItem value="MANAGER">Manager</SelectItem>
              {canAssignAdmin && <SelectItem value="ADMIN">Admin</SelectItem>}
            </SelectContent>
          </Select>
        </div>
        {!isEdit && (
          <div className="space-y-1 sm:col-span-2">
            <label className="text-xs font-medium text-[#555555]">Password</label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min 6 characters" required minLength={6} />
          </div>
        )}
        <div className="sm:col-span-2 flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button type="submit" size="sm" disabled={isPending}>
            {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {isEdit ? "Save Changes" : "Create User"}
          </Button>
        </div>
      </form>
    </div>
  );
}

// ─── Password Reset inline ────────────────────────────────────────────────────

function ResetPasswordRow({ userId, onClose }: { userId: string; onClose: () => void }) {
  const { toast } = useToast();
  const [pw, setPw] = useState("");
  const reset = trpc.user.resetPassword.useMutation({
    onSuccess: () => { toast({ title: "Password reset", variant: "success" }); onClose(); },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "error" }),
  });

  return (
    <div className="flex items-center gap-2 mt-1">
      <Input
        type="password"
        placeholder="New password (min 6)"
        className="h-7 text-xs w-44"
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        minLength={6}
      />
      <button
        onClick={() => pw.length >= 6 && reset.mutate({ userId, newPassword: pw })}
        disabled={pw.length < 6 || reset.isPending}
        className="text-[#111111] disabled:opacity-30"
        title="Confirm reset"
      >
        {reset.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
      </button>
      <button onClick={onClose} className="text-[#888888]" title="Cancel">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

// ─── CSV Import modal ─────────────────────────────────────────────────────────

type ImportRow = { name: string; email: string; password: string; role: Role; employeeId: string };

function parseCSV(text: string): { rows: ImportRow[]; errors: string[] } {
  const lines = text.trim().split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return { rows: [], errors: ["CSV must have a header row and at least one data row"] };

  const header = lines[0].toLowerCase().split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  const required = ["name", "email", "password"];
  const missing = required.filter((f) => !header.includes(f));
  if (missing.length) return { rows: [], errors: [`Missing required columns: ${missing.join(", ")}`] };

  const idx = (field: string) => header.indexOf(field);
  const rows: ImportRow[] = [];
  const errors: string[] = [];

  lines.slice(1).forEach((line, i) => {
    const cols = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const name = cols[idx("name")] ?? "";
    const email = cols[idx("email")] ?? "";
    const password = cols[idx("password")] ?? "";
    const rawRole = (cols[idx("role")] ?? "STUDENT").toUpperCase();
    const role = (["STUDENT", "INSTRUCTOR", "MANAGER", "ADMIN"].includes(rawRole) ? rawRole : "STUDENT") as Role;
    const employeeId = idx("employeeid") >= 0 ? (cols[idx("employeeid")] ?? "") : "";

    if (!name || !email || !password) {
      errors.push(`Row ${i + 2}: missing required field(s)`);
      return;
    }
    if (password.length < 6) {
      errors.push(`Row ${i + 2}: password too short (${email})`);
      return;
    }
    rows.push({ name, email, password, role, employeeId });
  });

  return { rows, errors };
}

function ImportModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ImportRow[] | null>(null);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");

  const bulkImport = trpc.user.bulkImport.useMutation({
    onSuccess: (data) => {
      toast({
        title: `Import complete`,
        description: `${data.created} created · ${data.updated} updated${data.errors.length ? ` · ${data.errors.length} errors` : ""}`,
        variant: data.errors.length ? "error" : "success",
      });
      onImported();
    },
    onError: (e) => toast({ title: "Import failed", description: e.message, variant: "error" }),
  });

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const { rows, errors } = parseCSV(ev.target?.result as string);
      setPreview(rows);
      setParseErrors(errors);
    };
    reader.readAsText(file);
  }

  function downloadTemplate() {
    const csv = "name,email,password,role,employeeid\nJane Smith,jane@example.com,password123,STUDENT,EMP-001\nJohn Doe,john@example.com,password123,INSTRUCTOR,EMP-002";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "users_template.csv";
    a.click();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-[#e8e8e8]">
          <h2 className="font-black text-lg tracking-tight text-[#111111]">Bulk Import Users</h2>
          <button onClick={onClose} className="text-[#888888] hover:text-[#111111]">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Instructions */}
          <div className="bg-[#f4f4f4] rounded-lg p-3 text-xs text-[#555555] space-y-1">
            <p className="font-semibold text-[#111111]">CSV format</p>
            <p>Required columns: <code className="bg-white px-1 rounded">name, email, password</code></p>
            <p>Optional columns: <code className="bg-white px-1 rounded">role</code> (STUDENT/INSTRUCTOR/ADMIN, defaults to STUDENT), <code className="bg-white px-1 rounded">employeeid</code></p>
            <p>Existing emails will be updated (name, role, employeeid, password).</p>
          </div>

          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={downloadTemplate}>
              <Download className="h-3.5 w-3.5" />
              Download Template
            </Button>
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
              <Upload className="h-3.5 w-3.5" />
              {fileName || "Choose CSV File"}
            </Button>
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
          </div>

          {parseErrors.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 space-y-1">
              {parseErrors.map((e, i) => (
                <p key={i} className="text-xs text-red-700 flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />{e}
                </p>
              ))}
            </div>
          )}

          {preview && preview.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-[#111111]">{preview.length} users ready to import</p>
              <div className="border border-[#e8e8e8] rounded-lg overflow-hidden max-h-56 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-[#f4f4f4] sticky top-0">
                    <tr>
                      {["Name", "Email", "Role", "Emp ID"].map((h) => (
                        <th key={h} className="text-left py-2 px-3 font-semibold text-[#555555]">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#f4f4f4]">
                    {preview.map((row, i) => (
                      <tr key={i}>
                        <td className="py-2 px-3">{row.name}</td>
                        <td className="py-2 px-3 text-[#888888]">{row.email}</td>
                        <td className="py-2 px-3">
                          <Badge variant={ROLE_COLORS[row.role] ?? "secondary"} className="text-[10px]">{row.role}</Badge>
                        </td>
                        <td className="py-2 px-3 text-[#888888]">{row.employeeId || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="p-5 border-t border-[#e8e8e8] flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => preview && bulkImport.mutate({ users: preview })}
            disabled={!preview || preview.length === 0 || bulkImport.isPending}
          >
            {bulkImport.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Import {preview?.length ? `${preview.length} Users` : ""}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AdminUsersPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<Role | undefined>(undefined);
  const [statusFilter, setStatusFilter] = useState<UserStatus | undefined>(undefined);
  const [sortBy, setSortBy] = useState<SortField>("createdAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRow | null>(null);
  const [resetPwId, setResetPwId] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showBulkRoleMenu, setShowBulkRoleMenu] = useState(false);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const { data: currentUser } = trpc.user.me.useQuery();

  function handleSearchChange(val: string) {
    setSearch(val);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setDebouncedSearch(val);
      setPage(1);
    }, 300);
  }

  function handleSort(field: SortField) {
    setPage(1);
    if (sortBy === field) {
      setSortDir((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(field);
    setSortDir(field === "createdAt" ? "desc" : "asc");
  }

  const { data, isLoading } = trpc.user.list.useQuery({
    page,
    limit: 20,
    search: debouncedSearch || undefined,
    role: roleFilter,
    status: statusFilter,
    sortBy,
    sortDir,
  });

  const bulkUpdateRole = trpc.user.bulkUpdateRole.useMutation({
    onSuccess: (data) => {
      toast({ title: `${data.updated} users updated`, variant: "success" });
      setSelected(new Set());
      setShowBulkRoleMenu(false);
      utils.user.list.invalidate();
    },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "error" }),
  });
  const setActive = trpc.user.setActive.useMutation({
    onSuccess: (user) => {
      toast({
        title: user.isActive ? "User reactivated" : "User deactivated",
        description: user.isActive
          ? "The account can sign in again with previous progress preserved."
          : "The account is inactive, but past progress and grades are preserved.",
        variant: "success",
      });
      utils.user.list.invalidate();
    },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "error" }),
  });
  const deleteUser = trpc.user.deleteUser.useMutation({
    onSuccess: () => {
      toast({ title: "User deleted", variant: "success" });
      utils.user.list.invalidate();
    },
    onError: (e) => toast({ title: "Delete failed", description: e.message, variant: "error" }),
  });

  function refresh() {
    utils.user.list.invalidate();
    setShowAddPanel(false);
    setEditingUser(null);
  }

  const users = data?.users ?? [];
  const isManager = currentUser?.role === "MANAGER";

  function isProtectedAdminAccount(user: UserRow) {
    return isManager && user.role === "ADMIN";
  }
  const selectableUsers = users.filter((user) => !isProtectedAdminAccount(user));
  const allSelected = selectableUsers.length > 0 && selectableUsers.every((u) => selected.has(u.id));

  function toggleAll() {
    if (allSelected) {
      setSelected((s) => { const n = new Set(s); users.forEach((u) => n.delete(u.id)); return n; });
    } else {
      setSelected((s) => {
        const n = new Set(s);
        users.forEach((u) => {
          if (!isProtectedAdminAccount(u)) n.add(u.id);
        });
        return n;
      });
    }
  }

  function toggleOne(id: string) {
    const user = users.find((entry) => entry.id === id);
    if (user && isProtectedAdminAccount(user)) return;
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-[#111111]">Users</h1>
          <p className="text-[#888888] mt-0.5 text-sm">{data?.total ?? 0} total</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowImport(true)}>
            <Upload className="h-3.5 w-3.5" />
            Import CSV
          </Button>
          <Button size="sm" onClick={() => { setShowAddPanel(true); setEditingUser(null); }}>
            <Plus className="h-3.5 w-3.5" />
            Add User
          </Button>
        </div>
      </div>

      {/* Add / Edit panel */}
      {(showAddPanel || editingUser) && (
        <UserFormPanel
          user={editingUser ?? undefined}
          currentUserRole={(currentUser?.role as Role | undefined) ?? undefined}
          onClose={() => { setShowAddPanel(false); setEditingUser(null); }}
          onSaved={refresh}
        />
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <Select
          value={roleFilter ?? ALL_ROLES}
          onValueChange={(value) => {
            setRoleFilter(value === ALL_ROLES ? undefined : (value as Role));
            setPage(1);
          }}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="All roles" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_ROLES}>All roles</SelectItem>
            <SelectItem value="STUDENT">Student</SelectItem>
            <SelectItem value="INSTRUCTOR">Instructor</SelectItem>
            <SelectItem value="MANAGER">Manager</SelectItem>
            <SelectItem value="ADMIN">Admin</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={statusFilter ?? ALL_STATUSES}
          onValueChange={(value) => {
            setStatusFilter(value === ALL_STATUSES ? undefined : (value as UserStatus));
            setPage(1);
          }}
        >
          <SelectTrigger className="w-[170px]">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_STATUSES}>All statuses</SelectItem>
            <SelectItem value="ACTIVE">Active</SelectItem>
            <SelectItem value="INACTIVE">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Search + bulk actions */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#888888]" />
          <Input
            placeholder="Search name, email, or employee ID…"
            className="pl-9"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
          />
        </div>

        {selected.size > 0 && (
          <div className="flex items-center gap-2 bg-[#f4f4f4] rounded-lg px-3 py-1.5">
            <span className="text-xs font-semibold text-[#111111]">{selected.size} selected</span>
            <div className="relative">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1"
                onClick={() => setShowBulkRoleMenu((v) => !v)}
              >
                Change Role <ChevronDown className="h-3 w-3" />
              </Button>
              {showBulkRoleMenu && (
                <div className="absolute top-8 left-0 bg-white border border-[#e8e8e8] rounded-lg shadow-lg z-10 py-1 min-w-[130px]">
                  {(["STUDENT", "INSTRUCTOR", "MANAGER", "ADMIN"] as Role[])
                    .filter((r) => !isManager || r !== "ADMIN")
                    .map((r) => (
                    <button
                      key={r}
                      onClick={() => bulkUpdateRole.mutate({ userIds: Array.from(selected), role: r })}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-[#f4f4f4] transition-colors"
                      disabled={bulkUpdateRole.isPending}
                    >
                      {r.charAt(0) + r.slice(1).toLowerCase()}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={() => setSelected(new Set())}
              className="text-[#888888] hover:text-[#111111]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-[#111111]" />
        </div>
      ) : users.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-[#888888]">
            <Users className="h-10 w-10 mx-auto mb-2 text-[#e8e8e8]" />
            No users found.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-[#e8e8e8] bg-[#fafafa]">
                  <tr>
                    <th className="py-3 px-4 w-8">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleAll}
                        className="rounded border-[#e8e8e8] accent-[var(--c-btn-primary)]"
                      />
                    </th>
                    <th className="text-left py-3 px-4 font-semibold text-[#555555]">
                      <button type="button" className="inline-flex items-center gap-1 hover:text-[#111111]" onClick={() => handleSort("name")}>
                        Name
                        <ArrowUpDown className="h-3.5 w-3.5" />
                      </button>
                    </th>
                    <th className="text-left py-3 px-4 font-semibold text-[#555555]">
                      <button type="button" className="inline-flex items-center gap-1 hover:text-[#111111]" onClick={() => handleSort("email")}>
                        Email
                        <ArrowUpDown className="h-3.5 w-3.5" />
                      </button>
                    </th>
                    <th className="text-left py-3 px-4 font-semibold text-[#555555]">Emp ID</th>
                    <th className="text-left py-3 px-4 font-semibold text-[#555555]">
                      <button type="button" className="inline-flex items-center gap-1 hover:text-[#111111]" onClick={() => handleSort("role")}>
                        Role
                        <ArrowUpDown className="h-3.5 w-3.5" />
                      </button>
                    </th>
                    <th className="text-left py-3 px-4 font-semibold text-[#555555]">
                      <button type="button" className="inline-flex items-center gap-1 hover:text-[#111111]" onClick={() => handleSort("status")}>
                        Status
                        <ArrowUpDown className="h-3.5 w-3.5" />
                      </button>
                    </th>
                    <th className="text-left py-3 px-4 font-semibold text-[#555555]">
                      <button type="button" className="inline-flex items-center gap-1 hover:text-[#111111]" onClick={() => handleSort("createdAt")}>
                        Joined
                        <ArrowUpDown className="h-3.5 w-3.5" />
                      </button>
                    </th>
                    <th className="text-left py-3 px-4 font-semibold text-[#555555]">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f4f4f4]">
                  {users.map((user) => (
                    <tr
                      key={user.id}
                      className={cn(
                        "transition-colors",
                        selected.has(user.id) ? "bg-[#f4f4f4]" : "hover:bg-[#fafafa]",
                        isProtectedAdminAccount(user) && "bg-red-50/40",
                      )}
                    >
                      <td className="py-3 px-4">
                      <input
                        type="checkbox"
                        checked={selected.has(user.id)}
                        onChange={() => toggleOne(user.id)}
                        className="rounded border-[#e8e8e8] accent-[var(--c-btn-primary)]"
                        disabled={isProtectedAdminAccount(user)}
                      />
                      </td>
                      <td className="py-3 px-4">
                        <div>
                          <p className="font-semibold text-[#111111]">{user.name ?? "—"}</p>
                          {resetPwId === user.id && (
                            <ResetPasswordRow userId={user.id} onClose={() => setResetPwId(null)} />
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-[#888888]">{user.email}</td>
                      <td className="py-3 px-4 text-[#888888] font-mono text-xs">{user.employeeId ?? "—"}</td>
                      <td className="py-3 px-4">
                        <Badge variant={ROLE_COLORS[user.role] ?? "secondary"}>{user.role}</Badge>
                        {isProtectedAdminAccount(user) && (
                          <p className="mt-1 text-[11px] text-red-600">Managers cannot modify admin accounts</p>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <Badge variant={user.isActive ? "success" : "secondary"}>
                          {user.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-[#888888] text-xs">{formatDate(user.createdAt)}</td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => {
                              if (isProtectedAdminAccount(user)) return;
                              setEditingUser(user);
                              setShowAddPanel(false);
                            }}
                            className="p-1.5 rounded-md text-[#888888] hover:text-[#111111] hover:bg-[#f4f4f4] transition-colors"
                            title="Edit user"
                            disabled={isProtectedAdminAccount(user)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => {
                              if (isProtectedAdminAccount(user)) return;
                              setResetPwId(resetPwId === user.id ? null : user.id);
                            }}
                            className={cn(
                              "p-1.5 rounded-md transition-colors",
                              resetPwId === user.id
                                ? "text-[#111111] bg-[#f4f4f4]"
                                : "text-[#888888] hover:text-[#111111] hover:bg-[#f4f4f4]",
                            )}
                            title="Reset password"
                            disabled={isProtectedAdminAccount(user)}
                          >
                            <KeyRound className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => {
                              if (isProtectedAdminAccount(user)) return;
                              setActive.mutate({ userId: user.id, isActive: !user.isActive });
                            }}
                            className={cn(
                              "p-1.5 rounded-md transition-colors",
                              user.isActive
                                ? "text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                                : "text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50",
                            )}
                            title={user.isActive ? "Deactivate user" : "Reactivate user"}
                            disabled={setActive.isPending || isProtectedAdminAccount(user)}
                          >
                            <Power className="h-3.5 w-3.5" />
                          </button>
                          {!isManager && (
                            <button
                              onClick={() => {
                                const confirmed = window.confirm(
                                  "Delete this user and all related courses, assessments, questions, enrollments, attempts, grades, and progress? This cannot be undone.",
                                );
                                if (!confirmed) return;
                                deleteUser.mutate({ userId: user.id });
                              }}
                              className="p-1.5 rounded-md text-[#888888] hover:text-red-600 hover:bg-red-50 transition-colors"
                              title="Delete user"
                              disabled={deleteUser.isPending}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pagination */}
      {data && data.pages > 1 && (
        <div className="flex items-center justify-center gap-4">
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
            <ChevronLeft className="h-4 w-4" />Previous
          </Button>
          <span className="text-sm text-[#888888]">Page {page} of {data.pages}</span>
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(data.pages, p + 1))} disabled={page === data.pages}>
            Next<ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Import modal */}
      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onImported={() => { setShowImport(false); utils.user.list.invalidate(); }}
        />
      )}
    </div>
  );
}
