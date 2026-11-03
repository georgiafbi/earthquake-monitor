# Plate boundary data

`Leaflet-Step-1/static/js/plates-data.js` is generated from Peter Bird's PB2002 model
(Bird, P. 2003, *An updated digital model of plate boundaries*, G3 4(3), 1027):

```sh
curl -o PB2002_steps.dat.txt http://peterbird.name/oldFTP/PB2002/PB2002_steps.dat.txt
node scripts/data-build/build-plates.js PB2002_steps.dat.txt Leaflet-Step-1/static/js/plates-data.js out.js
```

The second argument is the previous `plates-data.js` (plate names are taken from it).
Each of the 5,819 digitization steps keeps its class: SUB (subduction), OCB / CCB
(oceanic / continental convergent), OSR / CRB (spreading ridge / continental rift),
OTF / CTF (oceanic / continental transform). Consecutive steps of one boundary and class
become one line; `rate` is the relative plate speed in mm/yr; `sinks` names the
subducting plate. The earlier file had only two classes, so every spreading ridge was
drawn as a transform fault.
