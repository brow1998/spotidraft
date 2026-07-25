import { Navigate, Route, Routes } from "react-router-dom";
import Layout from "./Layout";
import HomePage from "./pages/HomePage";
import ImportPage from "./pages/ImportPage";
import ProgressPage from "./pages/ProgressPage";
import SessionPage from "./pages/SessionPage";
import SpotifyPage from "./pages/SpotifyPage";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="import" element={<ImportPage />} />
        <Route path="progress" element={<ProgressPage />} />
        <Route path="spotify" element={<SpotifyPage />} />
        <Route path="session" element={<SessionPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
