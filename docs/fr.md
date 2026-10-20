# NAD pour Gladys

Pilotez depuis Gladys vos amplis et amplis-tuners **NAD** dotés d'un port de
contrôle réseau (T 758, T 778, T 787, C 338, C 368, C 658, M10…), en local,
sans aucun cloud : allumage, veille, volume (plafonné), sourdine et source.

> **Important.** Cette intégration n'a jamais été testée avec un vrai
> appareil : elle a été écrite à partir de la bibliothèque `nad_receiver`
> (celle qu'utilise Home Assistant) et testée avec un faux appareil
> seulement. Vos retours sont les bienvenus. Intégration non officielle, sans
> lien avec NAD Electronics.

## Installation

1. Branchez l'appareil sur votre réseau et donnez-lui une **adresse IP fixe**
   dans votre box (bail DHCP réservé).
2. Sur l'appareil, activez la **veille réseau** (ou « contrôle IP » /
   « contrôle réseau » selon le modèle), pour qu'il réponde encore en veille
   et puisse être réveillé.
3. Dans Gladys, installez l'intégration **NAD**, puis ouvrez sa
   configuration.
4. Saisissez les adresses IP, séparées par des virgules (par exemple
   `192.168.1.50, 192.168.1.51`). Le port de contrôle est le 23 (telnet) ;
   pour un autre, ajoutez-le : `192.168.1.50:53`.
5. Choisissez le **plafond de volume** en dB (-20 dB par défaut) et, si vous
   le souhaitez, le volume le plus bas (-80 dB par défaut).
6. Les appareils apparaissent dans l'onglet **Découverte** : créez-les.

L'intégration garde une connexion ouverte avec chaque appareil : ce qui est
changé sur l'appareil ou sa télécommande s'affiche aussitôt dans Gladys. Les
états sont aussi relus chaque minute.

Seul le port réseau est pris en charge : le **port série RS-232** ne l'est
pas (une intégration Gladys tourne dans un conteneur sans accès au port
série).

## Ce que vous obtenez

| Fonction | Type Gladys                    | Remarque                                                 |
| -------- | ------------------------------ | -------------------------------------------------------- |
| Marche   | état binaire (lecture seule)   | 1 allumé, 0 en veille ou injoignable                     |
| Allumer  | bouton                         | `Main.Power=On`                                          |
| Veille   | bouton                         | `Main.Power=Off`                                         |
| Volume   | musique / volume (0 à 100)     | 0 % = volume le plus bas, 100 % = le plafond             |
| Sourdine | bouton (télévision / sourdine) | chaque appui lit l'état, puis règle l'inverse            |
| Source   | liste déroulante               | les entrées de l'appareil ; la liste ne fait que grandir |

Volontairement, aucun **interrupteur** : un « éteins tout » ou « allume
tout » d'un assistant vocal ou d'une scène ne réveille ni ne coupe votre
ampli.

## Plafond de volume

Les appareils NAD comptent leur volume en dB (par exemple -35 dB). Dans
Gladys, le volume va de 0 à 100 % : 0 % est le volume le plus bas de la
configuration (-80 dB par défaut), 100 % est le **plafond** (-20 dB par
défaut). Gladys (tableau de bord, scène, assistant vocal) ne peut jamais
régler un volume au-dessus du plafond. Le plafond est relu juste avant
l'envoi : une nouvelle valeur enregistrée s'applique aussitôt.

Le volume réglé sur l'appareil lui-même (bouton, télécommande) n'est pas
modifié par l'intégration (au-dessus du plafond, Gladys affiche 100 %), sauf
dans les deux cas où Gladys le rendrait audible :

- **Retrait de la sourdine** : si le volume de l'appareil dépasse le plafond,
  il est d'abord ramené au plafond, puis la sourdine est retirée. Si le
  volume ne peut pas être lu, rien n'est envoyé ; si l'appareil ne confirme
  pas la baisse, la sourdine est gardée.
- **Allumage** : après le réveil, le volume est relu et ramené au plafond
  s'il le dépasse, jusqu'à ce que l'appareil confirme un volume au plafond ou
  en dessous. Si l'appareil est lent à se réveiller, l'intégration vérifie
  encore quelques fois pendant environ 15 secondes, et baisse un volume
  signalé au-dessus du plafond pendant ce temps ; ensuite le volume n'est
  plus corrigé.

Une commande n'est réussie que si l'appareil répond la valeur demandée.

## Sources

Les entrées sont des numéros (1, 2, 3…). Leurs noms sont lus sur l'appareil
quand il les donne (`Source1.Name`…) ; sinon, saisissez-les dans la
configuration, par exemple `1=CD, 2=Tuner, 3=TV`. Une entrée choisie sur
l'appareil est ajoutée à la liste.

## Commandes

Chaque commande reçoit une réponse en moins de 4 secondes (Gladys attend 5
secondes). Une commande partie vers l'appareil sans confirmation est
signalée « envoyée, sans confirmation » ; la ligne écrite par l'appareil
montre ensuite ce qu'il a fait. Une commande qui n'a pas pu partir est
signalée « rien n'a été envoyé » : c'est le cas de toute commande, veille
comprise, vers un appareil non connecté. La **veille** passe avant toutes
les commandes en attente, et annule un allumage encore en attente.

## Reconnexion

Un appareil qui ne répond pas (éteint, veille réseau désactivée, débranché)
affiche sa marche à 0 et est nommé dans le statut de l'intégration.
L'intégration se reconnecte après 10 s, puis à intervalles doublés après
chaque échec, jusqu'à 5 minutes. Deux relectures de suite sans réponse
ferment la connexion, puis la même reconnexion espacée s'applique.

## Bouton de configuration

- **Vérifier les appareils** : la connexion, la marche, le volume (en dB), la
  sourdine et la source de chaque appareil, et la plage de volume en vigueur.

## Données et vie privée

L'intégration ne demande ni compte ni mot de passe : le port de contrôle NAD
n'en a pas. Elle garde dans `/data/nad.json` la liste des appareils connus
(adresse, modèle, sources). Rien ne sort de votre réseau local.

## Limites connues

- Une seule zone (la principale) ; pas de tuner, d'enceintes A/B, de
  luminosité, de minuterie ni de mode d'écoute.
- Certains modèles (par exemple le C 356BEE) ne savent ni donner ni régler un
  volume absolu, seulement le monter ou le baisser : le volume reste alors
  inconnu.
- Le protocole binaire des D 7050 / D 3045 (port 50001) n'est pas pris en
  charge.
- Home Assistant utilise par défaut le port 53 pour ce protocole,
  `nad_receiver` le port 23 : si votre appareil ne répond pas sur le 23,
  essayez `:53`.
- Jamais testé avec un vrai appareil : les vraies réponses peuvent différer.
