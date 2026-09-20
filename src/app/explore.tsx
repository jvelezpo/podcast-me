import { Redirect } from 'expo-router';

/**
 * Discover was folded into Library (Continue listening hero + Recently
 * added live in the Library header). This route stays as a redirect so old
 * deep links / back-stack entries land on Library instead of 404ing.
 */
export default function DiscoverRedirect() {
  return <Redirect href="/" />;
}
