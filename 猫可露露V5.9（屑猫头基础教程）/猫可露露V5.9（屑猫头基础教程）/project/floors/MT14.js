main.floors.MT14=
{
    "floorId": "MT14",
    "title": "14 层",
    "name": "14 层",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [],
    "ratio": 2,
    "defaultGround": "ground",
    "firstArrive": [],
    "eachArrive": [],
    "parallelDo": "",
    "events": {},
    "changeFloor": {
        "11,11": {
            "floorId": ":before",
            "stair": "upFloor"
        },
        "11,1": {
            "floorId": ":next",
            "stair": "downFloor"
        }
    },
    "beforeBattle": {},
    "afterBattle": {},
    "afterGetItem": {
        "1,11": [
            "\t[纳可]经过一段时间的熟悉后，\n对手中这把剑的掌握程度似乎又深了一层。",
            "\t[纳可]不过只是熟练度的提升而已。\n想要使用特殊技巧，恐怕还差得远呢。"
        ]
    },
    "afterOpenDoor": {},
    "autoEvent": {},
    "cannotMove": {},
    "cannotMoveIn": {},
    "map": [
    [  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1],
    [  1, 47,  0, 33,  1,231, 34,  0,  1, 28,  0, 87,  1],
    [  1,  0, 21,  0,234,  0,  1, 31,237,  0, 23, 27,  1],
    [  1, 83,  1,  1,  1, 86,  1,  1,  1,  1,  1, 82,  1],
    [  1, 28,  0,  1,  0,229,  1, 27,  1,578,  1,235,  1],
    [  1,  0,227, 81, 32,  0, 30,233, 81,228, 21,  0,  1],
    [  1, 34,  0,  1,  1,  1,  1, 82,  1,  1,  1, 81,  1],
    [  1,228,  1, 22, 81,231,  0, 34,  1, 28,  1, 31,  1],
    [  1, 27,228,  0,  1,  0, 28,227, 81,  0,230,  0,  1],
    [  1, 82,  1,  1,  1,  1,  1,  1,  1,  1,  1, 81,  1],
    [  1, 82,  1,  0, 22, 82,  0,  1, 28,  1, 21,  0,  1],
    [  1,614,237, 21,  0,  1, 34, 81,226, 81,  0, 88,  1],
    [  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1]
],
    "bgmap": [

],
    "fgmap": [

],
    "bg2map": [

],
    "fg2map": [

],
    "bgm": "2.mp3"
}