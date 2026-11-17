import { Link, Navigate, Route, Routes } from 'react-router-dom';
import Header from './components/Header.jsx';
import Home from './pages/Home.jsx';
import Hub from './pages/Hub.jsx';
import Quiz from './pages/Quiz.jsx';
import Game from './pages/Game.jsx';
import Admin from './pages/Admin.jsx';
import Reading from './pages/Reading.jsx';
import Surveys from './pages/Surveys.jsx';
import { usePlayer } from './lib/player.jsx';

function RequirePlayer({ children }) {
  const { player } = usePlayer();
  return player ? children : <Navigate to="/" replace />;
}

export default function App() {
  return (
    <div className="app">
      <Header />
      <main className="container">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/hub" element={<RequirePlayer><Hub /></RequirePlayer>} />
          <Route path="/quiz/:kind" element={<RequirePlayer><Quiz /></RequirePlayer>} />
          <Route path="/play/:level" element={<RequirePlayer><Game /></RequirePlayer>} />
          <Route path="/reading" element={<RequirePlayer><Reading /></RequirePlayer>} />
          <Route path="/surveys" element={<RequirePlayer><Surveys /></RequirePlayer>} />
          <Route path="/admin" element={<Admin />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <footer className="footer">
        Phishing Detective · Capstone Project · BS Information Systems, University of Rizal System · For training only. All phishing samples are fictional. · <Link to="/admin">Educator dashboard</Link>
      </footer>
    </div>
  );
}
