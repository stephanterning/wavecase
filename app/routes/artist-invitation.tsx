import {
  Form,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
} from "react-router";
import {
  artistInvitation,
  acceptArtistInvitation,
} from "../server/artist-members";
import { viewer, sameOrigin } from "../server/security";
import { ownsArtist } from "../server/ownership";
import { limitedBody } from "../server/request";
import { formError } from "../server/releases";

const signIn = (id: string) =>
  redirect("/?returnTo=" + encodeURIComponent(`/artist-invitations/${id}`));
export const meta = () => [
  { title: "Connect artist · Wavecase" },
  { name: "robots", content: "noindex" },
];
export const headers = () => ({ "Cache-Control": "no-store" });
export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await viewer(request);
  if (!user) return signIn(params.invitation!);
  const { artist } = await artistInvitation(params.invitation!);
  return {
    artist: { id: artist.id, name: artist.name },
    account: { id: user.id, name: user.name, email: user.email },
    invitationPath: `/artist-invitations/${params.invitation!}`,
    alreadyConnected: await ownsArtist(user.id, artist),
  };
}
export async function action({ request, params }: ActionFunctionArgs) {
  sameOrigin(request);
  const user = await viewer(request);
  if (!user) return signIn(params.invitation!);
  try {
    const form = await (await limitedBody(request, 2048)).formData();
    // A session changed in another tab must never accept as the wrong account.
    if (form.get("account") !== user.id)
      throw new Response(
        "Your signed-in account changed. Reload this page to confirm the current account.",
        { status: 409 },
      );
    const artistId = await acceptArtistInvitation(user.id, params.invitation!);
    return redirect(`/artist-profiles/${artistId}`);
  } catch (error) {
    return formError(error);
  }
}
export default function ArtistInvitation() {
  const data = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  return (
    <section className="welcome">
      <h1>
        {data.alreadyConnected ? "Artist already connected" : "Connect artist"}
      </h1>
      <p>
        Connect the artist <strong>{data.artist.name}</strong> to your Wavecase
        account{" "}
        <strong>
          {data.account.name} — {data.account.email}
        </strong>
        ?
      </p>
      <p>
        You will share all existing and future demos, versions, releases,
        internal discussions, external feedback, links and statistics, with full
        editing, publication and deletion rights.
      </p>
      {result?.error && <p role="alert">{result.error}</p>}
      {data.alreadyConnected ? (
        <a href={`/artist-profiles/${data.artist.id}`}>Open artist</a>
      ) : (
        <Form method="post">
          <input type="hidden" name="account" value={data.account.id} />
          <button disabled={navigation.state !== "idle"}>
            Connect artist to this account
          </button>
        </Form>
      )}
      <Form method="post" action="/logout">
        <input type="hidden" name="returnTo" value={data.invitationPath} />
        <button className="secondary">Use another account</button>
      </Form>
      <a href="/dashboard">Cancel</a>
    </section>
  );
}
