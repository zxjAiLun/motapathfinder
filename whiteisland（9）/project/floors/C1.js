main.floors.C1=
{
    "floorId": "C1",
    "title": "白骨岭",
    "name": "白骨岭",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [],
    "ratio": 1,
    "defaultGround": 50041,
    "bgm": "1.mp3",
    "firstArrive": [],
    "eachArrive": [],
    "parallelDo": "",
    "events": {
        "6,0": [
            {
                "type": "choices",
                "text": "可以选择在这里降低难度。\n你将得到10%伤害减免，以及本区域额外福利：\n2防御，20护盾。",
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
                                "value": "2"
                            },
                            {
                                "type": "setValue",
                                "name": "status:mdef",
                                "operator": "+=",
                                "value": "20"
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
        "1,11": {
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
    [158,158,158,158,158,158, 89,158,158,158,158,158,158],
    [158, 31,  0,158,158,  0,  0,  0,158, 32,158, 31,158],
    [158,  0, 32, 82,201, 22,  0, 21,201,  0,205,  0,158],
    [158,158,203,158,158,202,158,204,158,158,158,203,158],
    [158, 22,  0,158, 28,  0, 81, 21,158, 32,  0, 28,158],
    [158, 82,158,158,158,158,158, 81,158,203,158,158,158],
    [158, 21,  0,158,  0,204,  0,202,158,  0,158, 21,158],
    [158,  0, 32,202, 31,158, 27,  0,201, 31,202,  0,158],
    [158,158,205,158, 81,158,158,206,158,158, 86,158,158],
    [158, 28,  0,158,  0, 31,158, 29,  0,158, 22,  0,158],
    [158, 86,158,158, 31,  0, 81,  0, 27,213,  0, 47,158],
    [158, 87,  0, 81,  0, 21,158, 31,  0,158, 21,  0,158],
    [158,158,158,158,158,158,158,158,158,158,158,158,158]
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