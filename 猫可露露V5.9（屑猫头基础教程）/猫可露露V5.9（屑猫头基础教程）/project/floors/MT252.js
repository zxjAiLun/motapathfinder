main.floors.MT252=
{
    "floorId": "MT252",
    "title": "252 层",
    "name": "252 层",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [
        {
            "name": "03.jpg",
            "canvas": "bg",
            "x": 0,
            "y": 0
        }
    ],
    "ratio": 100000,
    "defaultGround": 919,
    "bgm": "16.mp3",
    "firstArrive": [],
    "eachArrive": [],
    "parallelDo": "",
    "events": {},
    "changeFloor": {
        "5,11": {
            "floorId": ":before",
            "stair": "upFloor"
        },
        "10,11": {
            "floorId": ":next",
            "stair": "downFloor"
        }
    },
    "beforeBattle": {},
    "afterBattle": {},
    "afterGetItem": {},
    "afterOpenDoor": {},
    "autoEvent": {},
    "cannotMove": {},
    "cannotMoveIn": {},
    "map": [
    [ 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20],
    [ 20, 20, 20, 20,572, 20,577, 20, 20, 20, 20,585, 20],
    [ 20, 20,579, 20, 81, 20,544,  0,542,572,540,  0, 20],
    [ 20,587,548, 81, 58, 20, 21, 20, 20,579, 20,546, 20],
    [ 20, 22,  0, 20, 21, 81, 22, 20, 20, 60, 20,587, 20],
    [ 20, 82, 20, 20, 20, 20, 20, 20, 20, 20, 20, 60, 20],
    [ 20,584, 20, 22, 82,572,586, 20,637, 81,538,576, 20],
    [ 20,551, 20, 82, 20, 20,542, 20,551, 20, 20, 20, 20],
    [ 20,  0, 20,540, 20, 20,585, 20,586, 20, 20, 20, 20],
    [ 20,547,620, 21, 20, 20,547,  0,546, 20, 20, 20, 20],
    [ 20, 23, 20, 20, 20, 20, 20,541, 20, 20, 20, 20, 20],
    [ 20, 20, 20, 20, 20, 88,  0, 21, 22,  0, 87, 20, 20],
    [ 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20]
],
    "bgmap": [

],
    "fgmap": [

],
    "bg2map": [],
    "fg2map": [],
    "weather": [
        "snow",
        2
    ]
}