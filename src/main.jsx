import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import TvApp from './components/TvApp.jsx';
import './styles.css';

// ?tv — the hall TV: the progressive display alone, full screen, unattended
const isTv = new URLSearchParams(window.location.search).has('tv');
createRoot(document.getElementById('root')).render(isTv ? <TvApp /> : <App />);
