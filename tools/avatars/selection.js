// The Rocketbox avatars and motion clips the game ships with (Microsoft Rocketbox Avatar Library, MIT licence).
// key = name used by the game (see SKINS / HOSTAGE_AVATARS in src/js/avatars.js)
module.exports = {
  REPO: 'https://github.com/microsoft/Microsoft-Rocketbox',
  RAW: 'https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/master',
  AVATARS: [
    ['swat', 'Professions/Police_Male_02'], ['beret', 'Professions/Police_Male_04'], ['plain', 'Professions/Police_Male_06'], ['patrol', 'Professions/Police_Male_01'],
    ['vest', 'Adults/Male_Adult_05'], ['beanie', 'Professions/Delivery_Male_01'], ['jacket', 'Adults/Male_Adult_04'], ['hoodie', 'Adults/Male_Adult_20'],
    ['suit', 'Professions/Business_Male_02'], ['shirt', 'Professions/Business_Male_06'], ['lady', 'Professions/Business_Female_02'],
  ],
  // [key, path under Assets/Animations without ".max.fbx", sampling rate]
  CLIPS: [
    ['idle', 'all_animations_max_motextr_static/m_idle_neutral_01', 15],
    ['walk', 'all_animations_max_motextr_xy/m_walk_fast_01', 30],
    ['jog', 'all_animations_max_motextr_xy/m_run_slow_01', 30],
    ['run', 'all_animations_max_motextr_xy/m_run_neutral_01', 30],
    ['crouch', 'all_animations_max_motextr_static/m_crouch_idle', 10],
  ],
};
