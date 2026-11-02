# Addarr

Addarr is a thin, safe front door to Radarr and Sonarr for one household's media library. It has two audiences: members, who browse and add anonymously, and the self-hoster admin, who configures exactly what "Add" means.

## Language

**Member**:
A person in the household who uses Addarr without an account. They browse and add titles anonymously. Members are the primary, deliberately non-technical users.
_Avoid_: Standard user, normal user

**Downloads**:
The member-facing page answering "where's my stuff?" It shows the household's titles that are downloading, not out yet, or recently arrived.
_Avoid_: Activity (for the member UI), Requests

**Queue**:
The admin console screen showing the *arr download queues raw: statuses, sizes, clients. Not to be confused with the member-facing Downloads page.
_Avoid_: using "queue" for the member UI

**Not out yet**:
The member-facing state of a monitored title whose content hasn't been released at all. That is an unreleased movie, or a series that hasn't started airing.
_Avoid_: Unreleased (the admin-side state name)

**More coming**:
The member-facing state of a series that's caught up on aired episodes but has more still scheduled to air.
_Avoid_: Continuing (the admin-side status name)

**Still looking**:
The member-facing state of a monitored title whose released content hasn't been found or downloaded yet. That is episodes that already aired without files, or a released movie with no file.
_Avoid_: Missing, wanted (admin-side state names)
