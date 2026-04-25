main.floors.D1=
{
    "floorId": "D1",
    "title": "兽巢",
    "name": "兽巢",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [],
    "ratio": 1,
    "defaultGround": 1038,
    "bgm": "2.mp3",
    "firstArrive": [],
    "eachArrive": [],
    "parallelDo": "",
    "events": {
        "11,0": [
            {
                "type": "choices",
                "text": "可以选择在这里降低难度。\n你将得到10%伤害减免，以及本区域额外福利：\n3防御。",
                "choices": [
                    {
                        "text": "降低难度",
                        "color": [
                            0,
                            255,
                            125,
                            1
                        ],
                        "action": [
                            {
                                "type": "setValue",
                                "name": "item:I582",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "status:def",
                                "operator": "+=",
                                "value": "3"
                            },
                            {
                                "type": "hide",
                                "remove": true
                            }
                        ]
                    },
                    {
                        "text": "取消",
                        "action": []
                    }
                ]
            }
        ]
    },
    "changeFloor": {
        "1,10": {
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
    [141,141,141,141,141,141,141,141,141,141,141, 89,141],
    [141,141, 29,227,  0,141, 32,141,141,141,  0,  0,141],
    [141, 27,  0,141, 27, 82,  0,202, 21,201, 27,  0,141],
    [141,141, 81,141,141,141,141,141, 81,141,201,141,141],
    [141,  0,204,141, 21,  0,202,  0, 31,203, 32,202,141],
    [141, 28,  0,203,  0, 27,141, 21,141, 22,141, 31,141],
    [141,202,141,141,141,141,141,141,141,141,141, 82,141],
    [141,  0, 32,141,  0, 28,141, 31,141,141, 28,  0,141],
    [141, 29,  0, 81,204,  0, 81,  0,202,201,  0, 29,141],
    [141,141, 82,141,141,206,141,212,141,141,141,221,141],
    [141, 87, 31,203,141,  0,141,  0, 34, 82,  0,576,141],
    [141,141,141,  0,212, 21, 81, 21,  0,141, 31,  0,141],
    [141,141,141,141,141,141,141,141,141,141,141,141,141]
],
    "bgmap": [

],
    "fgmap": [

],
    "bg2map": [

],
    "fg2map": [

]
}