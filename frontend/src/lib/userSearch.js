import { filterBy, haystackOf, searchTerms } from './textSearch';

export { searchTerms };

export function userHaystack(user) {
  if (!user) return '';
  return haystackOf(user.username, user.fullName, user.email);
}

export function filterUsers(users, query) {
  return filterBy(users, query, userHaystack);
}
