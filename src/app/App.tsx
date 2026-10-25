import { RouterProvider } from 'react-router-dom'
import { Providers } from './providers'
import { router } from './router'
import { UpdatePrompt } from './UpdatePrompt'

export function App() {
  return (
    <Providers>
      <RouterProvider router={router} />
      <UpdatePrompt />
    </Providers>
  )
}
