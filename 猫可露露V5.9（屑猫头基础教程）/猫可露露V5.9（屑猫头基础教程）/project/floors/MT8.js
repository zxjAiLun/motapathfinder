main.floors.MT8=
{
    "floorId": "MT8",
    "title": "8 层",
    "name": "8 层",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [],
    "ratio": 1,
    "defaultGround": "ground",
    "firstArrive": [
        "\t[纳可]那把佩剑，是父亲大人的！\n虽然不知道为什么被丢到这里，\n但是只要去拿到就好了吧。",
        "\t[纳可]……以我现在的实力，\n肯定发挥不出这些剑盾全部的能力。",
        "\t[纳可]不过——对付大地级之下的存在，\n恐怕已经足够了。"
    ],
    "eachArrive": [],
    "parallelDo": "",
    "events": {},
    "changeFloor": {
        "7,11": {
            "floorId": ":before",
            "stair": "upFloor"
        },
        "5,1": {
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
    [  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1],
    [  1, 32, 81, 32,  1, 87,  1, 27,220, 33,  1, 33,  1],
    [  1,  1,  1, 81,  1,  0,219,  0,  1,216,  1, 82,  1],
    [  1, 31,218, 31, 82,578,  1,220,  1, 31,  0, 21,  1],
    [  1, 81,  1, 81,  1,  1,  1, 81,  1,  1,  1, 81,  1],
    [  1, 33,  1,  0, 30, 81, 31,  0,219,  0, 28,  0,  1],
    [  1,221, 86,222,  1,  1,219,  1,  1, 32,  0, 27,  1],
    [  1,615,  1, 21,  0,218,  0, 22,  1,220, 34,  0,  1],
    [  1,  1,  1,  1,  1,  1, 82,  1,  1, 81,  1, 82,  1],
    [  1, 33, 82, 33,  1, 32,  0, 29,  1,  0,216, 28,  1],
    [  1,  1,  1, 82,  1, 81,  1,219, 81,217,  0,  1,  1],
    [  1, 32, 81, 32, 81, 27,  0, 88,  1, 21,221, 28,  1],
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
    "bgm": "1.mp3"
}