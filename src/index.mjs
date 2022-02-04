
// In order for the workers runtime to find the class that implements
// our Durable Object namespace, we must export it from the root module.
export { Counter } from './counter.mjs'

export default {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env)
    } catch (e) {
      return new Response(e.message)
    }
  },
}

async function handleRequest(request, env) {
  let id = env.COUNTER.idFromName('A')
  let obj = env.COUNTER.get(id)
  return await obj.fetch(request.url);
}
