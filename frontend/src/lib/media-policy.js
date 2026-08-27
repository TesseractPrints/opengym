// Media is opt-in because the exercise dataset's images and GIFs have separate commercial
// licensing. A build must state that licensed assets are available; every other value is
// deliberately text-only and makes no media requests.
export const exerciseMediaEnabled = (env = import.meta.env) =>
  env.VITE_EXERCISE_MEDIA === 'licensed'
