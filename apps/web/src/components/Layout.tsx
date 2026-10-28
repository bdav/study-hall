import { Outlet } from 'react-router-dom';
import { NavBar } from './NavBar';

export function Layout() {
  return (
    <div className="bg-ocean-gradient flex min-h-dvh flex-col">
      <NavBar />
      <Outlet />
    </div>
  );
}
