import { mountApp } from './app.js';
import { readPublicConfig } from './config/env.js';
import { getSupabaseClient } from './lib/supabase.js';
import './styles/tokens.css';
import './styles/base.css';
import './styles/picker.css';
import './styles/knockout.css';
import './styles/score-reveal.css';

const config = readPublicConfig(import.meta.env);
// Creating the client does not verify connectivity or load application data.
const supabase = getSupabaseClient(config);

mountApp(document.querySelector('#app'), { config, supabase });
