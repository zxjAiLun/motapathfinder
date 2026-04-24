main.floors.MT20=
{
    "floorId": "MT20",
    "title": "20 层",
    "name": "20 层",
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
        "7,11": {
            "floorId": ":before",
            "stair": "upFloor"
        },
        "1,11": {
            "floorId": ":next",
            "stair": "downFloor"
        }
    },
    "beforeBattle": {},
    "afterBattle": {
        "6,1": [
            {
                "type": "setValue",
                "name": "flag:door_MT20_2_11",
                "operator": "+=",
                "value": "1"
            }
        ]
    },
    "afterGetItem": {},
    "afterOpenDoor": {},
    "autoEvent": {
        "2,11": {
            "0": {
                "condition": "flag:door_MT20_2_11==1",
                "currentFloor": true,
                "priority": 0,
                "delayExecute": false,
                "multiExecute": false,
                "data": [
                    {
                        "type": "openDoor"
                    },
                    {
                        "type": "setValue",
                        "name": "flag:door_MT20_2_11",
                        "operator": "=",
                        "value": "null"
                    }
                ]
            }
        }
    },
    "cannotMove": {},
    "cannotMoveIn": {},
    "map": [
    [  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4],
    [  4,576, 31, 28, 34, 32,242, 32, 34, 27, 31,577,  4],
    [  4,  4,  4,  4,  4, 34, 32, 34,  4,  4,  4,  4,  4],
    [  4,  4,  4,  4,  4,  4, 81,  4,  4,  4,  4,  4,  4],
    [  1, 34,  0,240,585,  4,239,  4,576,240,  0, 22,  1],
    [  1,  1,238,  1,  1,  4, 81,  4,  1,  1,238,  0,  1],
    [  1,576,  0,237, 21,  4, 82,  4, 32,  1,578,  1,  1],
    [  1,  1,  1,  1,  0,  4, 81,  4, 34, 82,236, 27,  1],
    [  1, 34,236,  0,241,  4,239,  4, 32,  1,  1,237,  1],
    [  1, 83,  1, 21,  0,  4, 81,  4,  1,  1,241,  0,  1],
    [  1, 83,  1,236,  1,  1, 33,  0,578,237,  0, 81,  1],
    [  1, 87, 85,  0, 28,237,  0, 88,  1,  1, 34,  1,  1],
    [  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1]
],
    "bgmap": [

],
    "fgmap": [

],
    "bg2map": [],
    "fg2map": [],
    "bgm": "2.mp3"
}