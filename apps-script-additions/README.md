## 1-dashboardData.gs
Still needed — paste into the MAIN account's script (dropy.parcel.verifier), wire
into route_(e). See the file itself for details.

## Storage account quota — NO new code needed
Turns out every storage account's existing Code.gs already exposes exactly what
the dashboard needs, via `?action=capacity` (capacity_() in that file) — no key
required, no new deployment. The dashboard calls this directly. There used to be
a 2-quota.gs here proposing a new endpoint; deleted once we found the existing
one already does the job.
