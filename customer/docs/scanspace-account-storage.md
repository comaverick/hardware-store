# ScanSpace account storage

Firebase Authentication continues to handle sign-in. The existing Node API verifies
the Firebase ID token, including revocation, and checks the customer's verified email
and active MongoDB profile before accessing `/api/customer-scans`.

Original scan and room JSON files live in a **private Supabase Storage bucket**.
MongoDB stores their verified owner UID, original SHA-256 digest, byte count, chunk
size, name, save state, and current design. Updating finishes, room measurements,
or a name changes the design and revision; it does not replace the original file.

## Setup

1. Create a Supabase Free project. Copy the Project URL from Connect or Settings →
   Data API. Use the base `https://your-project.supabase.co` address.
2. Create a private bucket named `scanspace`. Leave Public bucket off and leave
   browser/anonymous access policies disabled. Allow `application/octet-stream`,
   or leave the allowed MIME types unrestricted. The object limit must allow 5 MiB.
3. Create a backend Secret key in Settings → API Keys. Put it only in `server/.env`:

   ```dotenv
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SECRET_KEY=your-backend-secret-key
   SUPABASE_STORAGE_BUCKET=scanspace
   SCANSPACE_TOTAL_STORAGE_BYTES=1000000000
   ```

   No Supabase secret or publishable key is needed in the customer frontend.
   `server/.env` is ignored by Git. Deployment secrets belong in the hosting
   provider's server environment settings, not a frontend build variable.
4. Restart the Node API after changing its environment. Keep the Firebase Admin
   configuration and existing MongoDB connection.

## Larger files and the free allowance

There is no fixed size cap per logical scan in the application. Import and raw
export no longer impose the former 64 MB/10 MB caps. Geometry and capture validation
remain in place, and opening a scan still requires enough memory on the device.

Supabase Free enforces a 50 MB limit per object and includes 1 GB total file storage.
The API streams multipart input to a temporary file, hashes the original bytes,
then uploads immutable objects of at most 5 MiB each. Downloads concatenate those
objects in order and verify the original digest. They return the original JSON file
through the authenticated API; no public or permanent download URLs are exposed.

The MongoDB storage budget atomically reserves the entire file's size before cloud
upload, across all customer accounts. A file can use the remaining overall allowance
but cannot exceed it. This budget covers this application's account scans; reduce
the setting if the Supabase project has other stored files. It is a storage allowance,
not a billing cap for the entire Supabase project. Keep the project on the Free plan
for the presentation. Free projects may pause after a week of inactivity.

Up to two authenticated uploads can stream concurrently. Temporary uploads are
removed on completion, parser errors, and cancellation; low temporary disk space
stops an upload. An unexpected process shutdown may leave a `.part` file in the OS
temporary `hardware-store-scanspace` directory. It contains no permanent account
save and can be removed after the API is stopped.

## Retries and account changes

Each new original uses an idempotency key scoped to its verified owner. Retrying
with the same file resumes missing chunks without overwriting existing objects or
reserving storage twice. A failed save remains visible as incomplete and keeps its
storage reservation until it is completed or deleted. Upload leases expire after
ten minutes without progress so an interrupted process does not permanently lock
the save. Deletion removes all objects before atomically releasing its reservation;
failed deletion can be retried.

Saved lists and open files are scoped to the current signed-in customer. The UI
aborts stale requests and closes an account scan when the customer changes. Before
a guest visits sign-in, its current original is temporarily preserved in IndexedDB
and reopened after sign-in. This does not upload automatically; the customer then
chooses Save to account. A storage-full error preserves the current editor state.

Existing browser-key room projects remain accessible through Rooms saved on this
device. Local room drafts and captured texture preferences remain explicitly local.
They are not automatically migrated or uploaded to another account.

## Verification

Run `npm run test:scanspace` from `server`. The account suite exercises authenticated
ownership, revisions, idempotency, interrupted writes/deletion, total storage, private
bucket enforcement, cleanup, and a 65 MiB multipart round trip through chunked storage
with in-memory database/cloud doubles. Client tests exercise account save/open,
original preservation, sign-in recovery, large-file import, and account switching.

Provider references: [file limits](https://supabase.com/docs/guides/storage/uploads/file-limits),
[pricing](https://supabase.com/pricing),
[private buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals),
[backend API keys](https://supabase.com/docs/guides/getting-started/api-keys).
