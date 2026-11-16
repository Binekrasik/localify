# Remote media protocol

Status: proposal, version 1 draft. Nothing in this document is implemented yet.

This document specifies how a media client talks to a media server. A client reads the server's library, streams
and downloads tracks, and agrees with the server on how much bandwidth to use. Clients holding the right
permissions also change the library. The protocol is HTTP with JSON, plus one WebSocket for events.

The document describes messages and the behavior each side can rely on. It says nothing about storage, indexing,
transcoding tools, caches, user interfaces or programming languages. A server that watches a folder of FLAC files
and a server backed by object storage and a transcoding farm can both conform. So can a browser player, a
command-line downloader and a management portal.

## 1. Scope

In scope:

- discovering a server and the protocol versions it speaks
- authenticating with access tokens, and limiting each token to a set of permissions
- reading tracks, albums, artists, playlists, artwork and lyrics
- streaming and downloading track audio
- negotiating bandwidth, including limits set by the user on the client and by an administrator on the server
- pushing library, limit and transfer changes to connected clients
- the management operations a web portal needs

Out of scope:

- the web portal itself. A portal is a client of this protocol that holds a token with management permissions.
  Its pages, its sign-in method and its hosting are separate work.
- how either side is built
- shared playback, remote control of another device, play history and recommendations
- video

## 2. Terms

| Term | Meaning |
| --- | --- |
| Server | The program that owns a library and answers this protocol |
| Client | Any program that calls the server: a player, a downloader, a portal |
| User | An account on the server |
| Access token | A secret string that identifies one client installation of one user |
| Scope | A named permission attached to a token |
| Track | One piece of audio with its metadata |
| Original | The audio file a track was added as |
| Rendition | One encoding of a track's audio. The original is a rendition. A transcode is another. |
| Transfer | A time-limited right to fetch one rendition of one track at an agreed rate |
| Bitrate | How many bits one second of encoded audio takes |
| Rate | How many bits per second travel over the network |

## 3. Conventions

The words MUST, MUST NOT, SHOULD and MAY have their RFC 2119 meanings.

**Base URL.** A server has one base URL, such as `https://music.example` or `http://192.168.1.50:8080/media`. The
user gives it to the client. Every path in this document is relative to it.

**Versions.** The major version is the first path segment, `/v1`. A change that would break a conforming version 1
client or server needs a new major version. Additions within version 1 are new optional fields, new endpoints and
new entries in the feature list.

**Unknown data.** Both sides MUST ignore object fields, event types and feature names they don't know. An optional
field that is absent means the same as one set to `null`.

**JSON.** Request and response bodies are UTF-8 JSON with `Content-Type: application/json`, except where an
endpoint carries media, images or lyrics text. Field names are camelCase.

**Units.** Each quantity has one unit everywhere in the protocol.

| Quantity | Unit | Example field |
| --- | --- | --- |
| Rate and bitrate | bits per second, integer | `maxRate`, `bitrate` |
| Size | bytes, integer | `size`, `burstBytes` |
| Duration and position | milliseconds, integer | `durationMs`, `startMs` |
| Point in time | RFC 3339 string in UTC | `expiresAt` |

**Identifiers.** An `id` is an opaque string of 1 to 64 characters from `A-Z a-z 0-9 _ -`. It is unique among
objects of its type on one server and stays the same for as long as the object exists. Clients MUST NOT read
meaning into it.

**Features.** Optional parts of the protocol have names. A server lists the ones it offers in `/info`. A request
to an endpoint of a feature the server lacks gets `501 not_implemented`.

**Cross-origin use.** A browser client is usually served from a different origin than the media server. The
server MUST answer CORS preflight requests and allow any origin on every endpoint. It MUST allow the request
headers `Authorization`, `Content-Type`, `Content-Disposition`, `If-Match`, `If-None-Match`, `If-Range` and
`Range`, and expose `Accept-Ranges`, `Content-Length`, `Content-Range`, `ETag`, `Retry-After` and
`Localify-Start-Ms`. The protocol never uses cookies, so allowing any origin gives a hostile page nothing. A page
served over HTTPS cannot call a plain HTTP server in most browsers, so a server meant for browser clients needs
TLS.

### 3.1 What the protocol fixes and what it leaves open

| Fixed | Left to the implementation |
| --- | --- |
| Paths, methods, JSON shapes and error codes | Storage, database, file layout |
| That every track's original is retrievable with byte ranges | Whether to transcode, with what tool, live or ahead of time |
| How a client states what it can decode and how much bandwidth it has | How the server picks among renditions that qualify |
| The upper bound on bytes the server sends per transfer and per token | The pacing algorithm and how spare bandwidth is shared |
| That limits from the client and the server combine by taking the lower one | Where limits are stored and how users edit them |
| Token format on the wire and the scope names | How tokens are generated, stored and shown to users |
| The events a socket carries | How the client buffers, caches, decodes and renders |

## 4. Discovery

`GET /info` needs no authentication. A client calls it first to learn whether the URL is a media server and what
it supports.

```json
{
  "protocol": "localify-media",
  "versions": [1],
  "server": {
    "id": "srv_4f9a1c",
    "name": "Home library",
    "software": "example-server/0.3"
  },
  "features": ["changes", "search", "transcode", "probe", "pairing", "management"],
  "portalUrl": "https://music.example/portal"
}
```

`server.id` identifies the library. It stays the same when the server's address changes, so a client can keep its
cached data across a move. `portalUrl` is optional and points at the management portal, if one exists.

| Feature | Adds |
| --- | --- |
| `changes` | The change feed in section 6.4 |
| `search` | `GET /v1/search` |
| `transcode` | Renditions other than the original |
| `probe` | `GET /v1/probe` for throughput measurement |
| `pairing` | Token handover through the portal, section 5.4 |
| `management` | Section 10 |

Everything not listed as a feature is required of every server.

## 5. Authentication

### 5.1 Access tokens

An access token is an opaque string with at least 128 bits of entropy. The server issues it, and it stands for one
installation of a client used by one user. A phone and a laptop hold different tokens, so either can be revoked or
limited without touching the other.

The client sends the token on every `/v1` request:

```http
Authorization: Bearer lfm_3q2hR8…
```

A token MUST NOT appear in a URL. A missing, unknown, expired or revoked token gets `401 unauthenticated`. A valid
token without the scope an endpoint needs gets `403 forbidden`, and `details.requiredScope` names the scope.

Tokens MAY expire. A server SHOULD store only a hash of each token.

### 5.2 Scopes

| Scope | Allows |
| --- | --- |
| `library:read` | Reading library metadata, artwork and lyrics |
| `media:stream` | Creating transfers with mode `stream` |
| `media:download` | Creating transfers with mode `download` |
| `playlists:write` | Creating, changing and deleting the user's own playlists |
| `library:write` | Adding, changing and deleting tracks, artwork, lyrics and any playlist; starting scans |
| `account` | Managing the user's own tokens and their limits |
| `admin` | Managing users, all tokens and server policy |

A library MAY show different users different content. Every response reflects what the calling token may see.

### 5.3 Token endpoints

| Request | Scope | Result |
| --- | --- | --- |
| `GET /v1/auth/token` | any | The calling token's description |
| `DELETE /v1/auth/token` | any | Revokes the calling token. `204`. |

```json
{
  "id": "tok_81",
  "name": "localify on laptop",
  "user": { "id": "u_1", "name": "ada" },
  "scopes": ["library:read", "media:stream", "media:download", "playlists:write"],
  "createdAt": "2026-11-13T18:02:11Z",
  "expiresAt": null
}
```

The secret string is never returned by these endpoints.

### 5.4 Getting a token

Every server MUST have some way to create a token and show it to the user once, so the user can paste it into a
client. A portal page or a command-line tool both qualify.

The `pairing` feature removes the pasting. The client asks for a pairing, shows the user a short code and a link,
and the user approves the request in the portal.

1. The client sends `POST /v1/auth/pairings` without authentication:

   ```json
   { "clientName": "localify on laptop", "scopes": ["library:read", "media:stream"] }
   ```

2. The server answers `201`:

   ```json
   {
     "id": "pr_Zk3vW9tQ1xN7bD4mS8aF2hJ6",
     "userCode": "KTRM-4X9P",
     "verificationUrl": "https://music.example/portal/pair",
     "expiresAt": "2026-11-13T21:15:00Z",
     "intervalMs": 3000
   }
   ```

3. The user opens `verificationUrl`, signs in to the portal, enters `userCode` and approves or denies. The portal
   MAY let the user reduce the requested scopes.
4. The client polls `GET /v1/auth/pairings/{id}` no faster than `intervalMs`. The answer is
   `{ "state": "pending" }`, `{ "state": "denied" }` or `{ "state": "approved", "token": "lfm_…" }`. The server
   returns the token once and then forgets the pairing. An expired or used pairing gets `404`.

The pairing `id` is a secret with at least 128 bits of entropy. `userCode` only needs to be unique among pending
pairings.

## 6. Library

### 6.1 Objects

A track:

```json
{
  "id": "t_9f2c",
  "title": "Night Drive",
  "artists": [{ "id": "ar_18", "name": "Example Artist" }],
  "album": { "id": "al_3", "title": "Example Album" },
  "discNumber": 1,
  "trackNumber": 4,
  "durationMs": 214500,
  "year": 2019,
  "genres": ["synthwave"],
  "artworkId": "aw_77",
  "accentColor": "#4634af",
  "lyrics": [{ "id": "ly_5", "format": "lrc", "language": "en" }],
  "source": {
    "mimeType": "audio/flac",
    "bitrate": 920884,
    "size": 24691200,
    "sampleRate": 44100,
    "bitDepth": 16,
    "channels": 2,
    "lossless": true
  },
  "addedAt": "2026-10-02T09:14:00Z",
  "updatedAt": "2026-11-01T20:40:12Z"
}
```

`id`, `title`, `artists`, `durationMs` and `source` are required. The rest is optional. The server fills a missing
title with a display name of its choice, so `title` is never empty. `artists` MAY be an empty array.

`source` describes the original. `source.bitrate` is the average, which is `size × 8 ÷ duration` for variable
bitrate and lossless files.

`accentColor` is a color the server derived from the artwork, as `#rrggbb`. A client can color its interface
without fetching the image first.

`lyrics` lists every lyrics document the track has. `format` is `lrc` for timed lines, `plain` for untimed text,
or another lowercase name a client may not know. `language` is a BCP 47 tag.

Albums, artists and playlists are smaller:

```json
{ "id": "al_3", "title": "Example Album", "artists": [{ "id": "ar_18", "name": "Example Artist" }],
  "year": 2019, "trackCount": 11, "durationMs": 2618000, "artworkId": "aw_77" }
```

```json
{ "id": "ar_18", "name": "Example Artist", "albumCount": 3, "trackCount": 34, "artworkId": "aw_12" }
```

```json
{ "id": "pl_2", "name": "Late shift", "description": "", "owner": { "id": "u_1", "name": "ada" },
  "trackCount": 48, "durationMs": 11280000, "artworkId": null, "updatedAt": "2026-11-12T23:01:00Z" }
```

A playlist with `owner: null` belongs to the library as a whole. A playlist MAY contain the same track more than
once.

### 6.2 Endpoints

All of these need `library:read`.

| Request | Result |
| --- | --- |
| `GET /v1/library` | The library revision and object counts |
| `GET /v1/tracks` | Page of tracks |
| `GET /v1/tracks/{id}` | One track |
| `GET /v1/albums`, `GET /v1/albums/{id}` | Page of albums, one album |
| `GET /v1/albums/{id}/tracks` | The album's tracks by disc and track number |
| `GET /v1/artists`, `GET /v1/artists/{id}` | Page of artists, one artist |
| `GET /v1/artists/{id}/albums`, `GET /v1/artists/{id}/tracks` | Pages |
| `GET /v1/playlists`, `GET /v1/playlists/{id}` | Page of playlists, one playlist |
| `GET /v1/playlists/{id}/tracks` | The playlist's tracks in playlist order |
| `GET /v1/artwork/{id}` | Image bytes |
| `GET /v1/lyrics/{id}` | Lyrics text |
| `GET /v1/changes` | Change feed, feature `changes` |
| `GET /v1/search` | Search results, feature `search` |

`GET /v1/tracks` also accepts `ids`, a comma-separated list of up to 100 track ids, and returns those tracks. Ids
the token cannot see are left out of the result.

### 6.3 Pages

Every collection endpoint returns a page:

```json
{ "items": [], "nextCursor": "b2Zmc2V0PTEwMA", "revision": "r_2041" }
```

| Parameter | Meaning |
| --- | --- |
| `limit` | Wanted page size. The default is 100. The server MAY return fewer items than asked. |
| `cursor` | The `nextCursor` of the previous page |
| `sort` | `title` or `addedAt`, with a leading `-` for descending order. Valid on tracks and albums. |

`nextCursor` is `null` on the last page. A client reads a whole collection by following cursors until then.
Without `sort`, the order is the server's choice and stays the same for one revision.

A cursor belongs to the revision it was issued at. When the library changes mid-read, the server either keeps
serving the old revision or answers `410 cursor_expired`, and the client starts over.

### 6.4 Revisions and changes

The library has a `revision`, an opaque string that changes whenever anything a token can see changes.
`GET /v1/library` returns it:

```json
{ "revision": "r_2041", "counts": { "tracks": 8312, "albums": 702, "artists": 415, "playlists": 9 } }
```

A client that cached the library compares revisions to learn whether its copy is stale. Connected clients also
receive `library.changed` on the socket.

Single objects and pages carry an `ETag`. A request with `If-None-Match` gets `304` when nothing changed.

With the `changes` feature, `GET /v1/changes?since=r_2040` lists what changed after a revision:

```json
{
  "revision": "r_2041",
  "items": [
    { "type": "track", "id": "t_9f2c", "change": "updated" },
    { "type": "album", "id": "al_9", "change": "deleted" }
  ],
  "nextCursor": null
}
```

`type` is `track`, `album`, `artist` or `playlist`. `change` is `created`, `updated` or `deleted`. The client
fetches created and updated objects itself. A server that no longer remembers `since` answers
`410 revision_expired`, and the client reads the library again from the start.

### 6.5 Search

`GET /v1/search?q=night&types=track,album&limit=20` returns the best matches of each requested type:

```json
{ "tracks": [], "albums": [], "artists": [], "playlists": [] }
```

How text matches is the server's choice.

### 6.6 Artwork and lyrics

`GET /v1/artwork/{id}` returns an image. The optional `size` parameter is the longest edge the client will display,
in pixels. The server returns the closest version it has that is at least that large, or the full image, and it
MUST NOT enlarge an image. The `Accept` header selects among image types when the server has several.

An artwork id names one exact image. When a track's picture changes, the track gets a new `artworkId`. Clients and
HTTP caches can therefore keep artwork forever, and the server SHOULD send
`Cache-Control: private, max-age=31536000, immutable`.

`GET /v1/lyrics/{id}` returns the document as `text/plain; charset=utf-8`. The `format` in the track object says how
to parse it.

Both endpoints need the `Authorization` header. A client that renders images through an element which cannot send
headers fetches the bytes first.

## 7. Transfers

Audio never comes from a library endpoint. A client first creates a transfer, in which both sides agree on the
rendition and the rate, and then fetches the bytes from the URL the transfer names.

The split exists for three reasons. The negotiation needs a request body, which a media element cannot send. The
media URL works without an `Authorization` header, so a browser's `<audio>` element, a download manager or a
system player can fetch it directly. And the transfer gives the server one object to account bandwidth against.

### 7.1 Creating a transfer

`POST /v1/transfers` needs `media:stream` or `media:download`, matching `mode`.

```json
{
  "trackId": "t_9f2c",
  "mode": "stream",
  "formats": ["audio/ogg; codecs=opus", "audio/mpeg"],
  "maxBitrate": 320000,
  "seek": ["bytes", "time"],
  "maxRate": null,
  "estimatedRate": 1500000
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `trackId` | yes | The track |
| `mode` | yes | `stream` for playback now, `download` to keep the file |
| `formats` | no | Media types the client can use, most preferred first. Absent means the original, whatever its type. |
| `maxBitrate` | no | Highest rendition bitrate the client wants. This is where a user's quality setting goes. |
| `seek` | no | Seek methods the client can handle, see section 7.4. The default is `["bytes"]`. |
| `maxRate` | no | Cap on this transfer's rate, on top of the token's limits |
| `estimatedRate` | no | The client's own measurement of what its connection carries right now |

An entry in `formats` is a media type, optionally with a `codecs` parameter as in RFC 6381. `audio/*` and `*/*`
are allowed. A rendition matches an entry when type and subtype agree and, if the entry names codecs, the
rendition uses only those.

The server answers `201`:

```json
{
  "id": "x_5JqT0m",
  "trackId": "t_9f2c",
  "mode": "stream",
  "url": "https://music.example/v1/media/x_5JqT0m?k=Zb81oRkq3nXw",
  "expiresAt": "2026-11-13T22:10:00Z",
  "rendition": {
    "mimeType": "audio/ogg; codecs=opus",
    "bitrate": 160000,
    "size": null,
    "durationMs": 214500,
    "original": false,
    "seek": "time",
    "etag": null,
    "sha256": null
  },
  "rate": 640000,
  "burstBytes": 262144
}
```

`rendition` is what the server will deliver. `rate` and `burstBytes` are the bandwidth terms, defined in section 8.

### 7.2 How the server chooses

A rendition is a candidate when all of these hold:

- it matches an entry in `formats`, or it is the original and `formats` is absent
- its bitrate is at most the request's `maxBitrate` and the token's effective `maxBitrate`
- its seek method is in the request's `seek`

The original always supports byte seeking. A server without the `transcode` feature has no other rendition.

Among candidates the server chooses freely. It SHOULD follow these preferences:

- for `download`, the original when it is a candidate
- for `stream`, the best quality whose bitrate fits the rate the transfer will get, taking `estimatedRate` into
  account when the client sent it
- between otherwise equal candidates, the earlier entry in `formats`

With no candidate the server answers `406 no_acceptable_rendition`. `details.available` lists the renditions it
could have delivered under the token's limits, as rendition objects, so the client can tell the user what is
missing.

`mode` states intent. It decides which scope and which limits apply. It cannot stop a client from saving a stream
it received, and the protocol does not pretend otherwise.

### 7.3 Fetching the bytes

The client sends `GET` to the transfer's `url`. It sends no `Authorization` header, because the URL contains its
own secret. `url` MAY point to another origin, which lets a server hand delivery to a CDN or an object store. The
client MUST treat the URL as a secret and SHOULD keep it out of logs.

The response carries the rendition's bytes with its `mimeType` as `Content-Type`. `HEAD` returns the same headers
without a body. For mode `download` the server sends `Content-Disposition: attachment` with a file name, and for
`stream` it sends `inline`.

One transfer MAY be fetched over several connections at once, as media elements do when they seek. The agreed rate
covers all of them together.

A transfer ends when `expiresAt` passes, when the client deletes it, when its token is revoked or when its track
is removed. A request to the URL of an ended transfer gets `410 transfer_gone`, or `404` once the server has
forgotten it. A response already in flight MAY finish. The client recovers by creating a new transfer. The server
SHOULD set `expiresAt` far enough ahead to play the track through with pauses.

### 7.4 Seeking

A rendition has one of two seek methods.

**`bytes`.** The server knows the rendition's full size, reports it in `rendition.size`, and supports single
`Range` requests as defined in RFC 9110. It answers `206` with `Content-Range`, sends `Accept-Ranges: bytes`, and
supports `If-Range`. `rendition.etag` holds the strong `ETag` the media URL returns. Two transfers whose renditions
have the same `etag` deliver identical bytes, so a client can continue an interrupted fetch through a new
transfer.

**`time`.** The server produces the rendition while sending it and cannot address it by byte. `rendition.size` MAY
be `null`. To seek, the client adds a `startMs` query parameter to the media URL and requests it again. The server
starts at the closest point it can decode from at or before `startMs` and reports that position in the
`Localify-Start-Ms` response header. The client adds this offset to the positions its decoder reports.

A client that only handles byte seeking leaves `seek` at its default and never receives a `time` rendition.

### 7.5 Downloads

A download is a transfer with mode `download`. The client fetches the URL to the end and keeps the result.

When the server knows the rendition's SHA-256 before sending, `rendition.sha256` holds it as 64 lowercase hex
digits, and the client SHOULD verify the finished file against it.

To resume, the client requests `Range: bytes=N-` with `If-Range` set to the rendition's `etag`. If the transfer
has ended, it creates a new one and checks that the new `etag` equals the old one before appending.

Downloading an album or a playlist is a series of transfers. The protocol has no archive format.

### 7.6 Other transfer requests

| Request | Result |
| --- | --- |
| `GET /v1/transfers` | The calling token's live transfers |
| `GET /v1/transfers/{id}` | One transfer, with its current `rate` |
| `PATCH /v1/transfers/{id}` | Changes `maxRate`. Returns the transfer. |
| `DELETE /v1/transfers/{id}` | Ends the transfer and frees its share of the budget. `204`. |

A client SHOULD delete a transfer it no longer needs. Skipping a track mid-stream is the common case.

## 8. Bandwidth

### 8.1 Why the server paces

A user on a metered or shared connection wants to cap what the player uses. The client cannot do that alone. A
browser gives a page no control over how fast a media element reads, and a receiver in general can only slow a
sender by refusing to read, which is crude and bursty. So the client tells the server its limit and the server
holds back.

The server has limits of its own. An administrator may cap the server's total upload, a user's share or one
device's share, and may restrict quality or volume. These are policy.

Both kinds of limit use the same fields. The lower value wins.

### 8.2 Limits

Limits belong to a token. `GET /v1/limits` returns three views:

```json
{
  "requested": { "maxRate": 4000000, "maxDownloadRate": 1000000 },
  "policy": {
    "maxRate": 20000000,
    "maxDownloadRate": null,
    "maxBitrate": null,
    "maxTransfers": 4,
    "quota": { "bytes": 53687091200, "usedBytes": 1203982336, "resetsAt": "2026-12-01T00:00:00Z" }
  },
  "effective": { "maxRate": 4000000, "maxDownloadRate": 1000000, "maxBitrate": null, "maxTransfers": 4 }
}
```

`requested` is what the client asked for on the user's behalf. `policy` is what the server's configuration allows
this token. `effective` is the lower of the two for each field, and it is what the server enforces. `null` means
no limit.

| Field | Client may request | Policy may set | Bounds |
| --- | --- | --- | --- |
| `maxRate` | yes | yes | The sum of `rate` over all the token's transfers |
| `maxDownloadRate` | yes | yes | The sum of `rate` over the token's `download` transfers |
| `maxBitrate` | no | yes | The bitrate of any rendition delivered to the token |
| `maxTransfers` | no | yes | How many transfers the token may have at once |
| `quota` | no | yes | Media bytes delivered to the token per period |

The client sets its part with `PUT /v1/limits`:

```json
{ "maxRate": 4000000, "maxDownloadRate": 1000000 }
```

The body replaces `requested` as a whole, and the response is the full limits object. Requested limits stay until
the client replaces them. A client SHOULD send them at startup and again whenever the user changes the setting or
the device moves to a different network. Any token may call both endpoints.

Policy comes from up to three places: the server as a whole, the user and the token. A server-wide or per-user cap
bounds the sum over every token under it. `policy` reports the configured caps that apply to this token. It does
not report how much of a shared cap other tokens are using at the moment. That shows up in each transfer's `rate`.

Per-request quality is not a limit. A client applies the user's quality setting by sending `maxBitrate` with each
transfer.

### 8.3 Rate and burst

Every transfer has a `rate` and a `burstBytes`, set by the server at creation and changed by it at any time.

For each transfer, over any interval of `t` seconds, the server MUST NOT send more than

```text
burstBytes + rate × t ÷ 8
```

bytes of media, counted across all connections fetching that transfer. This is a token bucket whose capacity is
`burstBytes` and whose refill speed is `rate`. The burst lets playback start and seeks land without waiting, and
the rate holds the long-run average. A server MAY send slower.

The server assigns rates under these rules:

1. The sum of `rate` over a token's transfers is at most `effective.maxRate`.
2. The sum of `rate` over a token's `download` transfers is at most `effective.maxDownloadRate`.
3. A transfer's `rate` is at most the `maxRate` the client gave for it.
4. Streams come first. The server SHOULD give every stream at least its rendition's bitrate, with headroom to
   build a buffer, before it gives downloads anything.

How the server splits what remains is its own business. A `rate` of `null` means the server applies no pacing to
that transfer, which is only allowed when rules 1 to 3 set no bound.

When a stream's `rate` is below its rendition's bitrate, the audio cannot arrive as fast as it plays. The server
SHOULD have chosen a smaller rendition if one was a candidate. Otherwise the transfer is still created, and the
client decides whether to buffer ahead before playing or to tell the user.

Metadata, artwork and lyrics responses are not paced. A server MAY count them toward a quota.

### 8.4 Measuring the connection

Neither side has to measure anything. A client that never sends an estimate still gets working transfers within
the configured limits. Measurements only improve the server's choice of rendition and its split between
transfers. Three tools exist:

- `estimatedRate` in a transfer request carries whatever the client knows, from earlier transfers or from the
  platform's network information.
- With the `probe` feature, `GET /v1/probe?bytes=1048576` returns that many unpaced bytes of
  `application/octet-stream` for the client to time. The server MAY return fewer, and `Content-Length` says how
  many. Probe bytes count toward a quota.
- On the socket, `ping` and `pong` give round-trip time, and `transfer.report` tells the server how a running
  transfer is doing.

A server can also measure for itself by watching how fast its own writes drain.

### 8.5 Renegotiation

Limits and rates change while transfers run. Each of these cases ends with the server sending `transfer.updated`
for every transfer whose `rate` changed, and `limits.changed` when the limits object changed.

| What happens | Who acts | How |
| --- | --- | --- |
| The user changes the cap in the client | Client | `PUT /v1/limits` |
| The user wants one download slower | Client | `PATCH /v1/transfers/{id}` with `maxRate` |
| An administrator or the user changes policy in the portal | Server | Recomputes `effective` |
| A second transfer starts or one ends | Server | Rebalances rates |
| A stream stalls while a download runs | Server | MAY move rate from the download after a `transfer.report` |

A client without a socket learns of changes by reading `GET /v1/limits` and `GET /v1/transfers/{id}`.

A transfer delivers one rendition from start to end. To change quality in the middle of a track, the client
creates a second transfer with a different `maxBitrate`, switches to it at a position of its choosing, and deletes
the first. Most players only need to adapt between tracks, by sending a fresh `estimatedRate` with the next
transfer.

### 8.6 Refusals

| Situation | Answer |
| --- | --- |
| The token already has `maxTransfers` transfers | `429 transfer_limit_reached` |
| The quota is used up | `403 quota_exceeded`, with `details.resetsAt` |
| The quota runs out during a transfer | The server ends the transfer and sends `transfer.ended` with reason `quota` |
| Too many API requests | `429 rate_limited`, with `Retry-After` |

## 9. Events socket

REST requests change state. The socket reports state changes and carries a few messages that only make sense
live. A client that never opens it loses nothing but promptness.

### 9.1 Connecting

The client opens a WebSocket to `/v1/socket` with the subprotocol `localify-media.v1`, using `wss` when the base
URL is `https` and `ws` otherwise. The handshake carries no credentials, because browsers cannot add headers to
it and the token must stay out of URLs.

Messages are JSON text frames of the form `{ "type": "…", "data": { … } }`.

The client's first message is `hello`:

```json
{ "type": "hello", "data": { "token": "lfm_3q2hR8…" } }
```

The server answers `welcome`:

```json
{
  "type": "welcome",
  "data": {
    "token": { "id": "tok_81", "user": { "id": "u_1", "name": "ada" }, "scopes": ["library:read", "media:stream"] },
    "libraryRevision": "r_2041",
    "limits": { "requested": {}, "policy": {}, "effective": {} },
    "heartbeatMs": 30000
  }
}
```

`limits` is the full object from section 8.2. The server sends nothing before `hello` and closes a socket that
stays silent for ten seconds.

Events are not replayed. After reconnecting, a client compares `libraryRevision` with its own and reads
`GET /v1/transfers` to catch up.

### 9.2 Messages

Client to server:

| Type | Data | Purpose |
| --- | --- | --- |
| `hello` | `token` | Authenticates the socket |
| `ping` | `t`, any number | Keeps the socket alive and measures round-trip time |
| `transfer.report` | `transferId`, `throughput`, `bufferedMs`, `stalled` | Tells the server how a transfer is doing |

Server to client:

| Type | Data | Sent when |
| --- | --- | --- |
| `welcome` | See above | `hello` succeeded |
| `pong` | `t` echoed, `serverTime` | Answering `ping` |
| `library.changed` | `revision` | The library revision changed. The server MAY merge rapid changes into one event. |
| `limits.changed` | The limits object | Any view of the token's limits changed |
| `transfer.updated` | `id`, `rate`, `burstBytes`, `expiresAt` | The server changed a transfer's terms |
| `transfer.ended` | `id`, `reason` | A transfer ended for a reason other than the client deleting it |
| `job.updated` | A job object, section 10.4 | A job the token started changed state |
| `error` | `code`, `message` | The server rejected a client message |

In `transfer.report`, `throughput` is the rate the client measured for that transfer since its last report,
`bufferedMs` is how much audio the client holds ahead of the playback position, and `stalled` is true while
playback waits for data. A client sends at most one report per transfer per second. Reports are advice. The server
MAY ignore them and MUST NOT use them for quota accounting.

`transfer.ended` reasons are `expired`, `revoked`, `quota` and `track_removed`.

The client sends `ping` at least every `heartbeatMs`. Either side MAY close a socket that has been silent for
twice that long.

### 9.3 Close codes

| Code | Meaning |
| --- | --- |
| `4400` | A message was not valid JSON or broke the message format |
| `4401` | The token in `hello` was rejected, or the token was revoked while connected |
| `4408` | No `hello` arrived in time |
| `4429` | The token has too many sockets open |

## 10. Management

The `management` feature covers what a portal needs to maintain a library and its users. A read-only server
leaves it out. The same endpoints serve any other client with the right scopes. A player that edits lyrics uses
the lyrics upload below.

How a portal signs its user in is not specified. Whatever the method, the portal ends up holding an access token
and calls these endpoints with it like any client.

### 10.1 Tracks, artwork and lyrics

All of these need `library:write`.

| Request | Body | Result |
| --- | --- | --- |
| `POST /v1/tracks` | The audio file | `201` with the track, or `202` with a job |
| `PATCH /v1/tracks/{id}` | JSON merge patch of metadata fields | The track |
| `DELETE /v1/tracks/{id}` | none | `204` |
| `PUT /v1/tracks/{id}/artwork` | An image | The track, with a new `artworkId` |
| `DELETE /v1/tracks/{id}/artwork` | none | The track |
| `POST /v1/tracks/{id}/lyrics?format=lrc&language=en` | Lyrics text | The track, with the new entry in `lyrics` |
| `PUT /v1/lyrics/{id}` | Lyrics text | `204` |
| `DELETE /v1/lyrics/{id}` | none | `204` |
| `POST /v1/library/scan` | none | `202` with a job |

An upload sends the file as the request body, with its media type in `Content-Type` and its name in
`Content-Disposition`. The server reads the tags and creates the track. A file the server cannot use gets
`415 unsupported_media_type`, and one that is too large gets `413 payload_too_large`.

`PATCH` follows RFC 7396 and accepts `title`, `artists`, `album`, `discNumber`, `trackNumber`, `year` and
`genres`. In a patch, `artists` is an array of names and `album` is a title, and the server links or creates the
matching artist and album objects. A client SHOULD send `If-Match` with the `ETag` it last saw. The server answers
`412 precondition_failed` if the track changed since. Whether an edit rewrites the file's tags or lives only in
the server's index is the server's choice.

`POST /v1/library/scan` asks a server that reads its library from storage to look for changes. A server with
nothing to scan answers `501 not_implemented`.

### 10.2 Playlists

| Request | Body | Result |
| --- | --- | --- |
| `POST /v1/playlists` | `name`, `description`, `shared` | `201` with the playlist |
| `PATCH /v1/playlists/{id}` | Any of the same fields | The playlist |
| `PUT /v1/playlists/{id}/tracks` | `{ "trackIds": [] }`, the full ordered list | The playlist |
| `DELETE /v1/playlists/{id}` | none | `204` |

`playlists:write` covers playlists the user owns. `library:write` covers every playlist. A playlist created with
`shared: true` gets `owner: null` and needs `library:write`. These endpoints are available without the
`management` feature if the server issues `playlists:write` tokens.

### 10.3 Users, tokens and policy

| Request | Scope | Result |
| --- | --- | --- |
| `GET /v1/auth/tokens` | `account` | The user's own tokens |
| `POST /v1/auth/tokens` | `account` | Creates a token for the user. The response holds the secret, once. |
| `DELETE /v1/auth/tokens/{id}` | `account` | Revokes one of the user's tokens |
| `PUT /v1/auth/tokens/{id}/policy` | `account` | Sets policy limits on one of the user's tokens |
| `GET /v1/users`, `POST /v1/users` | `admin` | Lists and creates users |
| `PATCH /v1/users/{id}`, `DELETE /v1/users/{id}` | `admin` | Changes and removes a user |
| `GET /v1/users/{id}/tokens`, `POST /v1/users/{id}/tokens` | `admin` | Lists and creates tokens for any user |
| `PUT /v1/users/{id}/policy` | `admin` | Sets policy limits for a user |
| `GET /v1/policy`, `PUT /v1/policy` | `admin` | Reads and sets server-wide policy limits |

A policy body uses the fields of section 8.2:

```json
{
  "maxRate": 8000000,
  "maxDownloadRate": 2000000,
  "maxBitrate": 320000,
  "maxTransfers": 2,
  "quota": { "bytes": 10737418240, "periodSeconds": 2592000 }
}
```

A token created through these endpoints cannot hold a scope its creator lacks. A user setting policy on their own
token can only tighten what the administrator allows, because the lower value wins at every level.

### 10.4 Jobs

Work that outlasts a request becomes a job. `GET /v1/jobs/{id}` returns it:

```json
{
  "id": "j_31",
  "type": "scan",
  "state": "running",
  "progress": { "done": 1204, "total": 8312 },
  "result": null,
  "error": null
}
```

`state` is `queued`, `running`, `succeeded` or `failed`. `type` is `scan` or `import`. A finished import has
`result.trackId`. A failed job has an `error` object as in section 11. Job changes also arrive as `job.updated` on
the socket.

## 11. Errors

Every error response has a JSON body, including errors from a media URL:

```json
{ "error": { "code": "no_acceptable_rendition", "message": "No rendition matches audio/aac.", "details": {} } }
```

`code` is stable and meant for programs. `message` is English text for logs and developers, and clients SHOULD
show their own wording to users. `details` depends on the code.

| Status | Code | Meaning |
| --- | --- | --- |
| 400 | `invalid_request` | Malformed body, unknown parameter value or failed validation |
| 401 | `unauthenticated` | No valid token |
| 403 | `forbidden` | The token lacks a scope. `details.requiredScope` names it. |
| 403 | `quota_exceeded` | The token's quota is used up |
| 404 | `not_found` | No such object, or the token may not see it |
| 406 | `no_acceptable_rendition` | Section 7.2 |
| 410 | `cursor_expired` | Section 6.3 |
| 410 | `revision_expired` | Section 6.4 |
| 410 | `transfer_gone` | Section 7.3 |
| 412 | `precondition_failed` | `If-Match` did not match |
| 413 | `payload_too_large` | The upload exceeds what the server accepts |
| 415 | `unsupported_media_type` | The server cannot use the uploaded file |
| 429 | `rate_limited` | Too many requests. `Retry-After` says when to try again. |
| 429 | `transfer_limit_reached` | Section 8.6 |
| 500 | `internal` | The server failed |
| 501 | `not_implemented` | The endpoint belongs to a feature this server lacks |
| 503 | `unavailable` | The server is temporarily unable to answer |

## 12. Security

- Tokens and media URLs are bearer secrets. Over plain HTTP anyone on the path can read them. A server reachable
  from outside a trusted network MUST use TLS.
- A media URL grants one rendition of one track until `expiresAt`. Its secret part MUST have at least 128 bits of
  entropy and MUST stop working when the transfer ends.
- Revoking a token ends its transfers and closes its sockets.
- The server MUST check scopes and visibility on every request, including requests for objects named by id inside
  a body.
- The server MUST limit pairing attempts and `userCode` guesses.
- The server validates uploads as untrusted input. Tag and image parsers are a common source of crashes.
- A client stores its token in the most protected storage its platform offers and never sends it anywhere but the
  server's base URL.

## 13. Left out of version 1

These were considered and left for later versions or features.

- Segmented adaptive streaming, where quality changes inside one track without a new request. A music track is
  short and small next to video, and choosing the rendition per track covers most of the benefit at a fraction of
  the work on both sides.
- Resumable uploads. A track upload is one request.
- Media URLs for artwork. Artwork needs the `Authorization` header, which costs browser clients a fetch per image.
- Offline playback rights. A downloaded file is a file, and the protocol attaches no license to it.

## 14. Open questions

1. Should the protocol define a username and password sign-in that returns a token? Without one, a portal written
   for one server cannot sign in to another. With one, every server has to store passwords.
2. Should `requested` limits expire on their own when a token goes quiet, in case a client set a low cap on a
   slow network and never came back to raise it?
3. Should policy be able to differ by time of day? An administrator may want full rate at night and a cap during
   work hours. The limits object would need a schedule, or the server can change policy on a timer and let
   `limits.changed` carry it.
