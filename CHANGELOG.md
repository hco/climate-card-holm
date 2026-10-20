# Changelog

## 1.2.0
- **Option Versatile Thermostat** (`vtherm: true`, proposée dans l'éditeur pour les entités VTherm) ([#4](https://github.com/kaaribou/climate-card-holm/issues/4)) :
  - pastilles fenêtre (avec **Ignorer** / **Rétablir**), présence, mouvement, délestage, sécurité et verrou ;
  - raison de l'arrêt sous le nom, bordure orange ou rouge en cas d'alerte ;
  - puce **Minuteur** : préréglage temporaire (30 min à 4 h) avec décompte et **Annuler** ;
  - taux de chauffe, puissance moyenne et température extérieure ;
  - préréglages Hors-gel, Délestage et Sécurité traduits.
- **Pastilles d'état** (`badges`) pour tout thermostat : jusqu'à 4 entités (fenêtre, présence, humidité…) sous le nom.
- Sans ces options, la carte est inchangée.

## 1.1.0
- **Vue compacte** (`layout: compact`) : sans la roue, moins haute et en largeur — modes Éteint / Chauffe / Clim et consigne − / + sur une ligne, options à côté ; en pleine largeur tout tient sur une seule ligne ([#1](https://github.com/kaaribou/climate-card-holm/issues/1)).
- **Ambiance « éteint »** : brume grise qui respire doucement et fines poussières, pour que la carte reste vivante même à l'arrêt.
- **Consigne minimum / maximum** réglables dans la carte (`min_temp`, `max_temp`), appliquées à la roue et aux boutons ([#2](https://github.com/kaaribou/climate-card-holm/issues/2)).
- **Mode ventilation** en 4ᵉ pastille (si l'appareil le propose) : couleur vert d'eau, filets d'air animés, et la roue comme les boutons − / + règlent la vitesse de ventilation quand il n'y a pas de consigne.
- **Sonde de température au choix** (`temperature_sensor`) et **historique au toucher** : graphique 24 h par défaut (`graph_hours`, boutons 6 h / 24 h / 48 h / 7 j) avec consigne, périodes de chauffe / clim, min / max / moyenne ([#3](https://github.com/kaaribou/climate-card-holm/issues/3)).

## 1.0.0
Première version publique.

- Carte climat compacte, lisible à **deux côte à côte** sur mobile et en pleine largeur (roue à gauche, commandes à droite).
- **Ambiance selon l'usage** : sobre à l'arrêt, lueur chaude et braises qui montent en chauffage, lueur froide et flocons en clim ; animations seulement quand l'appareil chauffe ou refroidit réellement.
- **Roue de consigne 270°** à faire glisser, boutons − / + dans l'ouverture de la roue, température actuelle repérée sur la roue.
- **Modes** Éteint / Chauffage / Clim en pastilles (et le mode en cours s'il est différent).
- **Ventilation, préréglage, oscillation verticale et horizontale** en puces compactes qui ouvrent un volet de choix.
- **Mises à jour immédiates** à l'écran, sans attendre la réponse de l'appareil (pratique avec les clims cloud).
- Texte toujours lisible, quel que soit le thème Home Assistant (clair ou sombre).
